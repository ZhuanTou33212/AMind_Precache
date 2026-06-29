const target = Number(process.argv[2] || 200);
const timeoutMs = Number(process.argv[3] || 240000);
const startedAt = Date.now();
let lastCount = -1;

async function getCount() {
  const response = await fetch('http://127.0.0.1:9800/api/images');
  const data = await response.json();
  return Array.isArray(data) ? data.length : 0;
}

while (Date.now() - startedAt < timeoutMs) {
  const count = await getCount().catch(() => 0);
  if (count !== lastCount) {
    console.log(`${new Date().toISOString()} cacheCount=${count}`);
    lastCount = count;
  }
  if (count >= target) {
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

process.exit(1);
