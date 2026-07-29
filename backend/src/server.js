import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createMemoryCard } from "./cardService.js";
import { CardStore } from "./store.js";

const store = new CardStore();
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";

export const server = createServer(async (request, response) => {
  cors(response);
  if (request.method === "OPTIONS") return send(response, 204, null);

  const url = new URL(request.url || "/", "http://localhost");
  const owner = String(request.headers["x-device-id"] || "local-device");

  try {
    if (request.method === "GET" && url.pathname === "/") {
      return send(response, 200, { service: "omo-api", status: "ok" });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return send(response, 200, {
        ok: true,
        service: "omo-api",
        modelConfigured: Boolean(process.env.QWEN_API),
        storage: "json"
      });
    }

    if (request.method === "GET" && url.pathname === "/api/memory-cards") {
      return send(response, 200, { cards: store.list(owner) });
    }

    if (request.method === "POST" && url.pathname === "/api/sources/image-flow") {
      const body = await readJSON(request);
      const card = await createMemoryCard({
        imageBase64: body.imageBase64,
        mimeType: body.mimeType
      });
      store.save(owner, card);
      return send(response, 200, { card: store.get(owner, card.id) });
    }

    const assessment = url.pathname.match(/^\/api\/memory-cards\/([^/]+)\/assessments$/);
    if (request.method === "POST" && assessment) {
      const body = await readJSON(request);
      const card = store.assess(
        owner,
        decodeURIComponent(assessment[1]),
        body.assessment,
        body.attemptId
      );
      return card
        ? send(response, 200, { card })
        : send(response, 404, { message: "记忆卡不存在。" });
    }

    const deletion = url.pathname.match(/^\/api\/memory-cards\/([^/]+)$/);
    if (request.method === "DELETE" && deletion) {
      const cardId = decodeURIComponent(deletion[1]);
      const deleted = store.delete(owner, cardId);
      return send(response, deleted ? 200 : 404, {
        deleted,
        cardId,
        ...(!deleted ? { message: "记忆卡不存在。" } : {})
      });
    }

    return send(response, 404, { message: "接口不存在。" });
  } catch (error) {
    const status = Number(error.statusCode || 500);
    return send(response, status, {
      message: error.message || "服务器暂时无法处理请求。"
    });
  }
});

function readJSON(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(httpError(413, "截图过大，请压缩后重试。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(httpError(400, "请求内容不是有效 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  if (status === 204) {
    response.writeHead(status);
    return response.end();
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function cors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "Content-Type,X-Device-Id");
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  server.listen(port, host, () => {
    console.log(`Omo API: http://${host}:${port}`);
  });
}
