package store

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type ImageRecord struct {
	Hash        string `json:"hash"`
	URL         string `json:"url"`
	PromptID    string `json:"promptId"`
	QuestionNum int    `json:"questionNum"`
	Reason      string `json:"reason"`
	CachedAt    int64  `json:"cachedAt"`
	FileSize    int64  `json:"fileSize"`
	Labels      any    `json:"labels"`
	LabelText   string `json:"labelText"`
	LabelStatus string `json:"labelStatus"`
	LabelMsg    string `json:"labelMessage,omitempty"`
	SubmittedAt int64  `json:"submittedAt"`
}

type Store struct {
	mu          sync.Mutex
	db          *sql.DB
	dataDir     string
	maxKeep     int
	platformURL string
}

func New(dataDir string, maxKeep int) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	imgDir := filepath.Join(dataDir, "images")
	os.MkdirAll(imgDir, 0755)

	dbPath := filepath.Join(dataDir, "cache.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS images (
		hash TEXT PRIMARY KEY, url TEXT, prompt_id TEXT,
		question_num INTEGER, reason TEXT, cached_at INTEGER, file_size INTEGER)`)
	if err != nil {
		return nil, err
	}

	// Config table — stores the full runtime config as JSON
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS config (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		data TEXT NOT NULL,
		updated_at INTEGER NOT NULL DEFAULT 0)`)
	if err != nil {
		return nil, err
	}
	for _, stmt := range []string{
		`ALTER TABLE images ADD COLUMN labels TEXT DEFAULT ''`,
		`ALTER TABLE images ADD COLUMN label_status TEXT DEFAULT 'pending'`,
		`ALTER TABLE images ADD COLUMN label_message TEXT DEFAULT ''`,
		`ALTER TABLE images ADD COLUMN submitted_at INTEGER DEFAULT 0`,
	} {
		if _, err := db.Exec(stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil, err
		}
	}

	return &Store{db: db, dataDir: dataDir, maxKeep: maxKeep}, nil
}

func (s *Store) Close() { s.db.Close() }

func HashURL(url string) string {
	h := sha1.Sum([]byte(url))
	return hex.EncodeToString(h[:])
}

// CacheImage downloads and stores an image. Enforces maxKeep rotation.
// Lock is only held for DB ops, NOT during network download.
func (s *Store) CacheImage(url, promptID string, questionNum int, reason string) (*ImageRecord, error) {
	hash := HashURL(url)

	// Check if already cached (quick lock)
	s.mu.Lock()
	var existing ImageRecord
	var labelsText string
	err := s.db.QueryRow(`SELECT hash,url,prompt_id,question_num,reason,cached_at,file_size,labels,label_status,label_message,submitted_at FROM images WHERE hash=?`, hash).
		Scan(&existing.Hash, &existing.URL, &existing.PromptID, &existing.QuestionNum, &existing.Reason, &existing.CachedAt, &existing.FileSize, &labelsText, &existing.LabelStatus, &existing.LabelMsg, &existing.SubmittedAt)
	if err == nil {
		s.db.Exec(`UPDATE images SET prompt_id=?,question_num=?,reason=?,cached_at=? WHERE hash=?`,
			promptID, questionNum, reason, time.Now().UnixMilli(), hash)
		s.mu.Unlock()
		existing.PromptID = promptID
		existing.QuestionNum = questionNum
		existing.Reason = reason
		existing.Labels, existing.LabelText = parseLabels(labelsText)
		return &existing, nil
	}

	// Evict if needed (still locked)
	if s.maxKeep > 0 {
		var count int
		s.db.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&count)
		if count >= s.maxKeep {
			rows, _ := s.db.Query(`SELECT hash FROM images ORDER BY cached_at ASC LIMIT ?`, count-s.maxKeep+1)
			var hashes []string
			for rows.Next() {
				var h string
				rows.Scan(&h)
				hashes = append(hashes, h)
			}
			rows.Close()
			for _, h := range hashes {
				os.Remove(filepath.Join(s.dataDir, "images", h+".img"))
				s.db.Exec(`DELETE FROM images WHERE hash=?`, h)
			}
		}
	}
	s.mu.Unlock()

	// Download (NO LOCK - network I/O)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", s.annotBase()+"/")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	imgPath := filepath.Join(s.dataDir, "images", hash+".img")
	f, _ := os.Create(imgPath)
	written, _ := io.Copy(f, resp.Body)
	f.Close()

	// Insert record (quick lock)
	s.mu.Lock()
	s.db.Exec(`INSERT INTO images(hash,url,prompt_id,question_num,reason,cached_at,file_size,labels,label_status,label_message,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		hash, url, promptID, questionNum, reason, time.Now().UnixMilli(), written, "", "pending", "", 0)
	s.mu.Unlock()

	return &ImageRecord{Hash: hash, URL: url, PromptID: promptID, QuestionNum: questionNum, Reason: reason, CachedAt: time.Now().UnixMilli(), FileSize: written, Labels: map[string][]string{}, LabelStatus: "pending"}, nil
}

func (s *Store) GetByHash(hash string) (*ImageRecord, error) {
	row := s.db.QueryRow(`SELECT hash,url,prompt_id,question_num,reason,cached_at,file_size,labels,label_status,label_message,submitted_at FROM images WHERE hash=?`, hash)
	var r ImageRecord
	var labelsText string
	err := row.Scan(&r.Hash, &r.URL, &r.PromptID, &r.QuestionNum, &r.Reason, &r.CachedAt, &r.FileSize, &labelsText, &r.LabelStatus, &r.LabelMsg, &r.SubmittedAt)
	if err != nil {
		return nil, err
	}
	r.Labels, r.LabelText = parseLabels(labelsText)
	return &r, nil
}

func (s *Store) ListImages() []ImageRecord {
	rows, _ := s.db.Query(`SELECT hash,url,prompt_id,question_num,reason,cached_at,file_size,labels,label_status,label_message,submitted_at FROM images ORDER BY question_num ASC`)
	defer rows.Close()
	var result []ImageRecord
	for rows.Next() {
		var r ImageRecord
		var labelsText string
		rows.Scan(&r.Hash, &r.URL, &r.PromptID, &r.QuestionNum, &r.Reason, &r.CachedAt, &r.FileSize, &labelsText, &r.LabelStatus, &r.LabelMsg, &r.SubmittedAt)
		r.Labels, r.LabelText = parseLabels(labelsText)
		result = append(result, r)
	}
	return result
}

func (s *Store) DeleteImage(hash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	os.Remove(filepath.Join(s.dataDir, "images", hash+".img"))
	s.db.Exec(`DELETE FROM images WHERE hash=?`, hash)
}

func (s *Store) OpenImage(hash string) (io.ReadCloser, int64, error) {
	imgPath := filepath.Join(s.dataDir, "images", hash+".img")
	fi, err := os.Stat(imgPath)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(imgPath)
	return f, fi.Size(), err
}

func (s *Store) Count() int {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&n)
	return n
}

func (s *Store) SetMaxKeep(n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maxKeep = n
	// Evict excess immediately
	if n > 0 {
		var count int
		s.db.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&count)
		if count > n {
			rows, _ := s.db.Query(`SELECT hash FROM images ORDER BY cached_at ASC LIMIT ?`, count-n)
			var hashes []string
			for rows.Next() {
				var h string
				rows.Scan(&h)
				hashes = append(hashes, h)
			}
			rows.Close()
			for _, h := range hashes {
				os.Remove(filepath.Join(s.dataDir, "images", h+".img"))
				s.db.Exec(`DELETE FROM images WHERE hash=?`, h)
			}
		}
	}
}

func (s *Store) SetPlatformURL(u string) { s.platformURL = u }

// SaveConfig stores the full config as JSON in SQLite
func (s *Store) SaveConfig(data []byte) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, ?)`,
		string(data), time.Now().Unix())
	return err
}

// LoadConfig reads the full config JSON from SQLite. Returns nil if not found.
func (s *Store) LoadConfig() ([]byte, error) {
	var data string
	err := s.db.QueryRow(`SELECT data FROM config WHERE id = 1`).Scan(&data)
	if err != nil {
		return nil, err
	}
	return []byte(data), nil
}

func (s *Store) annotBase() string {
	if s.platformURL != "" {
		return s.platformURL
	}
	return "https://annot.aminer.cn"
}

func (s *Store) DeleteByPromptID(promptID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var hash string
	err := s.db.QueryRow(`SELECT hash FROM images WHERE prompt_id=?`, promptID).Scan(&hash)
	if err == nil && hash != "" {
		os.Remove(filepath.Join(s.dataDir, "images", hash+".img"))
		s.db.Exec(`DELETE FROM images WHERE hash=?`, hash)
	}
}

func (s *Store) UpdateLabels(hash, promptID string, questionNum int, labels []byte) error {
	labels = normalizeLabels(labels)
	status := "pending"
	if string(labels) != "{}" {
		status = "labeled"
	}
	where, args := imageWhere(hash, promptID, questionNum)
	if where == "" {
		return fmt.Errorf("missing image identifier")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`UPDATE images SET labels=?,label_status=?,label_message='' WHERE `+where, append([]any{string(labels), status}, args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateLabelStatus(hash, promptID string, questionNum int, status, message string) error {
	where, args := imageWhere(hash, promptID, questionNum)
	if where == "" {
		return fmt.Errorf("missing image identifier")
	}
	submittedAt := int64(0)
	if status == "submitted" {
		submittedAt = time.Now().UnixMilli()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`UPDATE images SET label_status=?,label_message=?,submitted_at=? WHERE `+where, append([]any{status, message, submittedAt}, args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func imageWhere(hash, promptID string, questionNum int) (string, []any) {
	if hash != "" {
		return "hash=?", []any{hash}
	}
	if promptID != "" {
		return "prompt_id=?", []any{promptID}
	}
	if questionNum > 0 {
		return "question_num=?", []any{questionNum}
	}
	return "", nil
}

func normalizeLabels(labels []byte) []byte {
	var v map[string][]string
	if len(labels) == 0 || json.Unmarshal(labels, &v) != nil {
		return []byte("{}")
	}
	out, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return out
}

func parseLabels(text string) (any, string) {
	if strings.TrimSpace(text) == "" {
		return map[string][]string{}, ""
	}
	var labels map[string][]string
	if err := json.Unmarshal([]byte(text), &labels); err != nil {
		return map[string][]string{}, ""
	}
	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, key := range keys {
		parts = append(parts, labels[key]...)
	}
	return labels, strings.Join(parts, "_")
}
