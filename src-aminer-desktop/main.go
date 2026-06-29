package main

import (
	"aminer-desktop/store"
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

//go:embed ui/*
var uiFS embed.FS

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	procSetWindowPos    = user32.NewProc("SetWindowPos")
	procGetWindowTextW  = user32.NewProc("GetWindowTextW")
	procEnumWindows     = user32.NewProc("EnumWindows")
	procIsWindowVisible = user32.NewProc("IsWindowVisible")
	HWND_TOPMOST        = uintptr(^uintptr(0))
	SWP_NOMOVE          = uintptr(0x0002)
	SWP_NOSIZE          = uintptr(0x0001)
	SWP_SHOWWINDOW      = uintptr(0x0040)
)

var dataDir string
var st *store.Store
var config = struct {
	Token       string `json:"token"`
	TaskID      string `json:"taskId"`
	StartDate   string `json:"startDate"`
	CacheSize   int    `json:"cacheSize"`
	PlatformURL string `json:"platformUrl"`
	OssHost     string `json:"ossHost"`
	TaggerID    string `json:"taggerId"`
}{}

var defaultLabelsConfig = []byte(`{
  "groups": [
    {
      "id": "quality",
      "name": "图片质量",
      "mode": "single",
      "required": true,
      "options": [
        { "id": "amazing", "label": "惊艳", "hotkey": "Q", "aliases": ["惊艳"] },
        { "id": "good", "label": "好看", "hotkey": "W", "aliases": ["好看"] },
        { "id": "nice", "label": "还不错", "hotkey": "E", "aliases": ["还不错"] },
        { "id": "normal", "label": "一般", "hotkey": "R", "aliases": ["一般"] },
        { "id": "bad", "label": "不堪", "hotkey": "T", "aliases": ["不堪"] },
        { "id": "border", "label": "带边框", "hotkey": "Y", "aliases": ["带边框", "边框", "frame"] }
      ]
    },
    {
      "id": "watermark",
      "name": "水印",
      "mode": "multi",
      "required": false,
      "options": [
        { "id": "watermark_yes", "label": "带水印", "hotkey": "A", "aliases": ["带水印", "水印", "logo"] }
      ]
    }
  ],
  "submit": {
    "enabled": false,
    "batchSize": 5,
    "strategy": "keyboard"
  }
}`)

type monState struct {
	mu       sync.Mutex
	Question int `json:"question"`
	Total    int `json:"total"`
	Count    int `json:"count"`
}

var mon = &monState{}
var monPage = 0 // which page to poll for annotation changes
var monRunning = false

func (s *monState) set(q, t, c int) {
	s.mu.Lock()
	s.Question = q
	s.Total = t
	s.Count = c
	s.mu.Unlock()
}
func (s *monState) get() (int, int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Question, s.Total, s.Count
}

func annotBase() string {
	if config.PlatformURL != "" {
		return config.PlatformURL
	}
	return "https://annot.aminer.cn"
}

func pollAnnotations() {
	deleted := make(map[string]bool)
	for monRunning {
		time.Sleep(5 * time.Second)
		if config.Token == "" || config.TaskID == "" || config.StartDate == "" || monPage == 0 {
			continue
		}
		url := fmt.Sprintf(annotBase()+"/api/v1/annotations/annot/prompts/task/%s/date/%s/v2?page=%d",
			config.TaskID, config.StartDate, monPage)
		resp, err := doAMinerGet(url)
		if err != nil {
			continue
		}
		var data struct {
			Prompts   []struct {
				PromptID string `json:"prompt_id"`
				State    int    `json:"state"`
			} `json:"prompts"`
			TotalPage int `json:"total_page"`
		}
		json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()

		allDone := true
		for _, p := range data.Prompts {
			if p.State == 1 && !deleted[p.PromptID] {
				deleted[p.PromptID] = true
				st.DeleteByPromptID(p.PromptID)
			}
			if p.State != 1 {
				allDone = false
			}
		}
		// 当前页全部标注完成，自动翻页
		if allDone && len(data.Prompts) > 0 && monPage < data.TotalPage {
			monPage++
			// 重置 deleted 避免跨页内存膨胀
			deleted = make(map[string]bool)
		}
	}
}

func (s *monState) getQuestion() int { s.mu.Lock(); defer s.mu.Unlock(); return s.Question }
func (s *monState) getTotal() int    { s.mu.Lock(); defer s.mu.Unlock(); return s.Total }

func findPrefetchWindow() uintptr {
	var hwnd uintptr
	cb := syscall.NewCallback(func(h syscall.Handle, p uintptr) uintptr {
		visible, _, _ := procIsWindowVisible.Call(uintptr(h))
		if visible == 0 {
			return 1
		}
		buf := make([]uint16, 256)
		procGetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		title := syscall.UTF16ToString(buf)
		if strings.Contains(title, "AMiner Image Prefetch") ||
			strings.Contains(title, "127.0.0.1:9800") ||
			strings.Contains(title, "AMiner Desktop") {
			hwnd = uintptr(h)
			return 0
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return hwnd
}

func pinTopmost() bool {
	hwnd := findPrefetchWindow()
	if hwnd != 0 {
		procSetWindowPos.Call(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW)
		return true
	}
	return false
}

func pinTopmostSoon() {
	go func() {
		for i := 0; i < 20; i++ {
			if pinTopmost() {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
	}()
}

func main() {
	exeDir, _ := os.Executable()
	dataDir = filepath.Join(filepath.Dir(exeDir), "data")

	var err error
	st, err = store.New(dataDir, 0)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	cfgPath := filepath.Join(dataDir, "config.json")

	// Load config: SQLite primary, JSON as seed/fallback
	if cfgB, err := os.ReadFile(cfgPath); err == nil {
		json.Unmarshal(cfgB, &config)
	}
	// Seed SQLite from JSON on first run
	if dbCfg, err := st.LoadConfig(); err == nil {
		json.Unmarshal(dbCfg, &config)
	} else if b, _ := json.Marshal(config); len(b) > 2 {
		st.SaveConfig(b)
	}
	if config.OssHost == "" {
		config.OssHost = "mm-group-image.oss-cn-beijing.aliyuncs.com"
	}

	// Auto-start annotation monitor if config is complete
	if config.Token != "" && config.TaskID != "" && config.StartDate != "" && !monRunning {
		monRunning = true
		monPage = 1
		go pollAnnotations()
		log.Printf("Auto-started annotation monitor (page=1)")
	}

	// Apply stored cacheSize to store
	if config.CacheSize > 0 {
		st.SetMaxKeep(config.CacheSize)
	}
	if config.PlatformURL != "" {
		st.SetPlatformURL(config.PlatformURL)
	}

	mux := http.NewServeMux()

	// CORS middleware: 允许来自标注页面的跨域请求
	corsHandler := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			if r.Method == "OPTIONS" {
				w.WriteHeader(200)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			// Merge: only update fields present in the request body
			var incoming struct {
				Token       string `json:"token"`
				TaskID      string `json:"taskId"`
				StartDate   string `json:"startDate"`
				CacheSize   *int   `json:"cacheSize"`
				PlatformURL string `json:"platformUrl"`
				OssHost     string `json:"ossHost"`
				TaggerID    string `json:"taggerId"`
			}
			body, _ := io.ReadAll(r.Body)
			json.Unmarshal(body, &incoming)

			oldCacheSize := config.CacheSize
			if incoming.Token != "" {
				config.Token = incoming.Token
			}
			if incoming.TaskID != "" {
				config.TaskID = incoming.TaskID
			}
			if incoming.StartDate != "" {
				config.StartDate = incoming.StartDate
			}
			// Only update cacheSize if explicitly sent (prevents extension from overwriting)
			if incoming.CacheSize != nil {
				config.CacheSize = *incoming.CacheSize
			}
			if incoming.PlatformURL != "" {
				config.PlatformURL = incoming.PlatformURL
				st.SetPlatformURL(incoming.PlatformURL)
			}
			if incoming.OssHost != "" {
				config.OssHost = incoming.OssHost
			}
			if incoming.TaggerID != "" {
				config.TaggerID = incoming.TaggerID
			}

			if strings.HasPrefix(config.Token, "{") {
				var wr struct {
					AccessToken string `json:"access_token"`
				}
				if json.Unmarshal([]byte(config.Token), &wr) == nil && wr.AccessToken != "" {
					config.Token = wr.AccessToken
				}
			}
			// Update store maxKeep when cacheSize changes
			if config.CacheSize > 0 && config.CacheSize != oldCacheSize {
				st.SetMaxKeep(config.CacheSize)
			}
			// Auto-start monitor if newly configured
			if config.Token != "" && config.TaskID != "" && config.StartDate != "" && !monRunning {
				monRunning = true
				monPage = 1
				go pollAnnotations()
			}
			b, _ := json.Marshal(config)
			os.WriteFile(cfgPath, b, 0644)
			st.SaveConfig(b)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(config)
	})

	mux.HandleFunc("/api/labels-config", func(w http.ResponseWriter, r *http.Request) {
		cfgPath := filepath.Join(dataDir, "labels-config.json")
		if r.Method == "POST" {
			body, _ := io.ReadAll(r.Body)
			var check any
			if len(body) == 0 || json.Unmarshal(body, &check) != nil {
				http.Error(w, "invalid labels config json", 400)
				return
			}
			os.WriteFile(cfgPath, body, 0644)
		}
		body, err := os.ReadFile(cfgPath)
		if err != nil || len(body) == 0 {
			body = defaultLabelsConfig
		}
		// Strip UTF-8 BOM if present
		if len(body) >= 3 && body[0] == 0xEF && body[1] == 0xBB && body[2] == 0xBF {
			body = body[3:]
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(body)
	})

	mux.HandleFunc("/api/image-labels", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var req struct {
			Hash        string          `json:"hash"`
			PromptID    string          `json:"promptId"`
			QuestionNum int             `json:"questionNum"`
			Labels      json.RawMessage `json:"labels"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if err := st.UpdateLabels(req.Hash, req.PromptID, req.QuestionNum, req.Labels); err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("/api/image-label-status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var req struct {
			Hash        string `json:"hash"`
			PromptID    string `json:"promptId"`
			QuestionNum int    `json:"questionNum"`
			Status      string `json:"status"`
			Message     string `json:"message"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Status == "" {
			req.Status = "pending"
		}
		if err := st.UpdateLabelStatus(req.Hash, req.PromptID, req.QuestionNum, req.Status, req.Message); err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("/api/prompts", func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		if page == "" {
			page = "1"
		}
		url := annotBase() + "/api/v1/annotations/annot/prompts/task/" + config.TaskID +
			"/date/" + config.StartDate + "/v2?page=" + page
		resp, err := doAMinerGet(url)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)
	})

	mux.HandleFunc("/api/question", func(w http.ResponseWriter, r *http.Request) {
		pid := r.URL.Query().Get("id")
		if pid == "" {
			http.Error(w, "missing id", 400)
			return
		}
		resp, err := doAMinerGet(annotBase() + "/api/v1/bench/questions/" + pid + "?uid=")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)
	})

	mux.HandleFunc("/api/cache", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			URL, PromptID string
			QuestionNum   int
		}
		json.NewDecoder(r.Body).Decode(&req)
		rec, err := st.CacheImage(req.URL, req.PromptID, req.QuestionNum, "manual")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(rec)
	})

	mux.HandleFunc("/api/images", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			for _, img := range st.ListImages() {
				st.DeleteImage(img.Hash)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(st.ListImages())
	})

	mux.HandleFunc("/api/image/", func(w http.ResponseWriter, r *http.Request) {
		hash := strings.TrimPrefix(r.URL.Path, "/api/image/")
		reader, size, err := st.OpenImage(hash)
		if err != nil {
			http.Error(w, "not found", 404)
			return
		}
		defer reader.Close()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		io.Copy(w, reader)
	})

	mux.HandleFunc("/api/images/", func(w http.ResponseWriter, r *http.Request) {
		st.DeleteImage(strings.TrimPrefix(r.URL.Path, "/api/images/"))
		w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("/api/pin", func(w http.ResponseWriter, r *http.Request) {
		ok := pinTopmost()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"ok": ok})
	})

	// Monitor - extension POSTs page state here
	mux.HandleFunc("/api/monitor", func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		// Log captured submission API details for direct API research
		var raw map[string]interface{}
		if json.Unmarshal(bodyBytes, &raw) == nil {
			if t, _ := raw["type"].(string); t == "captured-submission-api" {
				log.Printf("[CAPTURED API] %v %v status=%v body=%v",
					raw["method"], raw["url"], raw["status"], raw["requestBody"])
				// Auto-extract tagger_id from first captured submission
				if rb, ok := raw["requestBody"].(string); ok && config.TaggerID == "" {
					var sub struct{ TaggerID string `json:"tagger_id"` }
					if json.Unmarshal([]byte(rb), &sub) == nil && sub.TaggerID != "" {
						config.TaggerID = sub.TaggerID
						log.Printf("[SUBMIT] Auto-configured tagger_id=%s", config.TaggerID)
						// Persist immediately
						b, _ := json.Marshal(config)
						os.WriteFile(filepath.Join(dataDir, "config.json"), b, 0644)
						st.SaveConfig(b)
					}
				}
			}
			if t, _ := raw["type"].(string); t == "captured-prompts-api" {
				log.Printf("[CAPTURED PROMPTS] %v resp=%v",
					raw["url"], raw["responseText"])
			}
			if t, _ := raw["type"].(string); t == "captured-annot-api" {
				log.Printf("[CAPTURED ANNOT] %v %v resp=%v",
					raw["method"], raw["url"], raw["responseText"])
			}
			if t, _ := raw["type"].(string); t == "captured-postmessage" {
				log.Printf("[CAPTURED POSTMSG] %v keys=%v data=%v",
					raw["msgType"], raw["keys"], raw["data"])
			}
		}

		var req struct {
			Question, Total int
			PromptID, Type  string
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Type == "submission" && req.PromptID != "" {
			st.DeleteByPromptID(req.PromptID)
		}
		mon.set(req.Question, req.Total, st.Count())
		w.Write([]byte(`{"ok":true}`))
	})

	// Monitor state - GUI polls this
	mux.HandleFunc("/api/monitor-state", func(w http.ResponseWriter, r *http.Request) {
		q, t, c := mon.get()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"question": q, "total": t, "count": c})
	})

	// Start API-based annotation monitor
	mux.HandleFunc("/api/monitor-start", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Page, Question int }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Page > 0 {
			monPage = req.Page
			mon.set(req.Question, 0, st.Count())
		}
		if !monRunning {
			monRunning = true
			go pollAnnotations()
		}
		w.Write([]byte(`{"ok":true}`))
	})

	// Submit labels directly to AMiner API (bypass DOM/keyboard)
	mux.HandleFunc("/api/submit", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Hash     string              `json:"hash"`
			Labels   map[string][]string `json:"labels"`
			TaggerID string              `json:"taggerId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if req.Hash == "" {
			http.Error(w, "missing hash", 400)
			return
		}
		if req.TaggerID == "" {
			req.TaggerID = config.TaggerID
		}
		if req.TaggerID == "" {
			http.Error(w, "missing taggerId", 400)
			return
		}
		if config.Token == "" || config.TaskID == "" {
			http.Error(w, "not configured: token or taskId missing", 400)
			return
		}

		record, err := st.GetByHash(req.Hash)
		if err != nil {
			http.Error(w, "image not found: "+err.Error(), 404)
			return
		}

		// Get resp_id from bench/questions API
		respID, err := getRespID(config.TaskID, record.PromptID)
		if err != nil {
			http.Error(w, "resp_id not found: "+err.Error(), 500)
			return
		}

		// Find assignment_id by searching prompts API for the prompt_id
		assignmentID := findAssignmentID(config.TaskID, config.StartDate, record.PromptID, record.QuestionNum)
		if assignmentID == 0 {
			http.Error(w, "assignment_id not found for prompt "+record.PromptID, 500)
			return
		}

		// Construct payload
		payload := mapLabelsToPayload(req.Labels)
		body := map[string]interface{}{
			"assignment_id": assignmentID,
			"tagger_id":     req.TaggerID,
			"prompt_id":     record.PromptID,
			"responses": []map[string]interface{}{
				{"resp_id": respID, "payload": payload},
			},
			"task_id": mustAtoi(config.TaskID),
		}

		bodyJSON, _ := json.Marshal(body)
		log.Printf("[SUBMIT] Sending: %s", string(bodyJSON))

		resp, err := doAMinerPost(annotBase()+"/api/v1/annotations/annot/responses", bodyJSON)
		if err != nil {
			st.UpdateLabelStatus(req.Hash, "", 0, "submit_failed", err.Error())
			http.Error(w, "submit failed: "+err.Error(), 500)
			return
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			st.UpdateLabelStatus(req.Hash, "", 0, "cloud_submitted", "API submitted directly")
			log.Printf("[SUBMIT] Success for hash=%s prompt=%s", req.Hash, record.PromptID)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"ok":true,"status":"cloud_submitted"}`))
		} else {
			st.UpdateLabelStatus(req.Hash, "", 0, "submit_failed", string(respBody))
			log.Printf("[SUBMIT] Failed status=%d body=%s", resp.StatusCode, string(respBody))
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"ok":false,"status":"submit_failed","httpStatus":%d,"body":%q}`, resp.StatusCode, string(respBody))
		}
	})

	uiSub, _ := fs.Sub(uiFS, "ui")
	uiHandler := http.FileServer(http.FS(uiSub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".html") || r.URL.Path == "/" || !strings.Contains(r.URL.Path, ".") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}
		uiHandler.ServeHTTP(w, r)
	}))

	port := "9800"
	go openBrowser("http://127.0.0.1:" + port)
	// pinTopmostSoon() // 禁用窗口置顶，避免页面重构
	log.Printf("AMiner Desktop on http://127.0.0.1:%s (CORS enabled)", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, corsHandler(mux)))
}

func doAMinerGet(url string) (*http.Response, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+config.Token)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", annotBase()+"/")
	req.Header.Set("Origin", annotBase())
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return resp, nil
}

func doAMinerPost(url string, body []byte) (*http.Response, error) {
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+config.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", annotBase()+"/")
	req.Header.Set("Origin", annotBase())
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func genUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func mustAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// getRespID calls bench/questions API and extracts the first response's id (resp_id)
func getRespID(taskID, promptID string) (string, error) {
	url := annotBase() + "/api/v1/bench/questions/" + promptID + "?uid="
	resp, err := doAMinerGet(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		Responses []struct {
			ID       string `json:"id"`
			PromptID string `json:"prompt_id"`
		} `json:"responses"`
	}
	body, _ := io.ReadAll(resp.Body)
	if json.Unmarshal(body, &data) != nil {
		return "", fmt.Errorf("failed to parse bench/questions response")
	}
	if len(data.Responses) == 0 {
		return "", fmt.Errorf("no responses in bench/questions for %s", promptID)
	}
	log.Printf("[SUBMIT] got resp_id=%s for prompt=%s", data.Responses[0].ID, promptID)
	return data.Responses[0].ID, nil
}

// findAssignmentID searches the prompts API for the assignment_id matching a given prompt_id
func findAssignmentID(taskID, startDate, promptID string, questionNum int) int {
	if taskID == "" || startDate == "" || promptID == "" {
		return 0
	}
	startPage := 1
	if questionNum > 0 {
		startPage = (questionNum-1)/20 + 1
	}
	// Search startPage and up to 4 adjacent pages
	for page := startPage; page < startPage+5; page++ {
		if page < 1 {
			continue
		}
		url := annotBase() + "/api/v1/annotations/annot/prompts/task/" + taskID +
			"/date/" + startDate + "/v2?page=" + strconv.Itoa(page)
		resp, err := doAMinerGet(url)
		if err != nil {
			continue
		}
		var data struct {
			Prompts []struct {
				ID       int    `json:"id"`
				PromptID string `json:"prompt_id"`
			} `json:"prompts"`
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if json.Unmarshal(body, &data) != nil {
			continue
		}
		for _, p := range data.Prompts {
			if p.PromptID == promptID {
				return p.ID
			}
		}
	}
	return 0
}

// labelValue maps user-facing label text to submission payload numeric values
var labelValue = map[string]int{
	"惊艳":   1,
	"好看":   3,  // 推测值，建议手动提交一次确认
	"还不错":  2,
	"一般":   0,
	"不堪":   -1,
	"带边框":  -2,
	"带水印":  1,
}

func mapLabelsToPayload(labels map[string][]string) map[string]int {
	payload := map[string]int{"level": 0, "watermark": 0}
	for groupID, values := range labels {
		for _, v := range values {
			num, ok := labelValue[v]
			if !ok {
				continue
			}
			switch groupID {
			case "quality":
				payload["level"] = num
			case "watermark":
				payload["watermark"] = num
			}
		}
	}
	return payload
}

func openBrowser(url string) {
	time.Sleep(500 * time.Millisecond)
	for _, p := range []string{
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	} {
		if _, err := os.Stat(p); err == nil {
			exec.Command(p, "--app="+url, "--window-size=600,800").Start()
			return
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
