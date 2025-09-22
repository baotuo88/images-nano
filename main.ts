// --- START OF REPLACEMENT FILE: main.ts ---

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const PORT = parseInt(Deno.env.get("PORT") ?? "3000", 10);

// --- 新增：类型定义 ---
interface ProviderConfig {
  name: string;
  apiUrl: string;
  apiKey: string;
  type: 'openrouter' | 'openai_dalle'; // 定义支持的适配器类型
  model: string;
}

// --- 新增：启动时加载和解析配置 ---
let PROVIDERS: ProviderConfig[] = [];
try {
  const configJson = Deno.env.get("AI_PROVIDERS_CONFIG");
  if (configJson) {
    PROVIDERS = JSON.parse(configJson);
    console.log(`Loaded ${PROVIDERS.length} AI providers.`);
  } else {
    console.warn("AI_PROVIDERS_CONFIG environment variable is not set.");
  }
} catch (e) {
  console.error("Failed to parse AI_PROVIDERS_CONFIG:", e);
}


// ===== 工具函数 =====
function okJson(obj: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function extractImageDataUrl(data: unknown, providerType: ProviderConfig['type']): string | null {
  // 根据不同的服务商类型，解析返回的数据
  if (providerType === 'openai_dalle') {
    const b64 = (data as any)?.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  }
  
  // 默认使用 openrouter 的解析方式
  try {
    const msg = (data as any)?.choices?.[0]?.message;
    const url = msg?.images?.[0]?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:image/")) return url;
    const content: string | undefined = typeof msg?.content === "string" ? msg.content : undefined;
    if (content) {
      const m = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
      if (m) return m[0];
    }
  } catch {/* ignore */}
  return null;
}

// ===== 业务处理 =====
async function handleGenerate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const {
      prompt = "",
      images = [],
      providerName, // 前端传来的是服务商的名字
      count = 1,
    } = body ?? {};

    if (!providerName) {
      return okJson({ error: "Missing providerName" }, { status: 400 });
    }
    
    // 从内存中查找对应的服务商配置
    const provider = PROVIDERS.find(p => p.name === providerName);
    if (!provider) {
      return okJson({ error: `Provider "${providerName}" not found or misconfigured on server` }, { status: 400 });
    }

    // --- 新增：根据 provider.type 适配请求体 ---
    let providerPayload: any;
    if (provider.type === 'openai_dalle') {
      providerPayload = {
        model: provider.model,
        prompt: prompt,
        n: Math.min(Math.max(count, 1), 1), // DALL-E 3 only supports n=1
        size: "1024x1024",
        response_format: "b64_json",
      };
    } else { // 默认按 openrouter/gemini 格式
      const imgContents = Array.isArray(images)
        ? images
            .filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"))
            .map((dataUrl: string) => ({ type: "image_url", image_url: { url: dataUrl } }))
        : [];
      providerPayload = {
        model: provider.model,
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [{ type: "text", text: prompt }, ...imgContents],
        }],
      };
    }
    
    const results: string[] = [];
    const n = provider.type === 'openai_dalle' ? 1 : Math.min(Math.max(count, 1), 4);
    
    for (let i = 0; i < n; i++) {
        const resp = await fetch(provider.apiUrl, {
            method: "POST",
            headers: {
            "Authorization": `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
            },
            body: JSON.stringify(providerPayload),
        });

        if (!resp.ok) {
            const errorText = await resp.text();
            return okJson({ error: "Provider API returned an error", detail: { status: resp.status, snippet: errorText.slice(0, 300) } }, { status: resp.status });
        }

        const responseData = await resp.json();
        const imageDataUrl = extractImageDataUrl(responseData, provider.type);

        if (!imageDataUrl) {
            const msgContent = (responseData as any)?.choices?.[0]?.message?.content;
            return okJson({ retry: true, message: msgContent || "Model returned no image in response" });
        }
        results.push(imageDataUrl);
    }

    return okJson({ images: results });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return okJson({ error: "Internal Server Error", detail: errorMessage }, { status: 500 });
  }
}

// ===== 路由分发 =====
function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);

  // --- 新增：返回可用的服务商列表 (安全地) ---
  if (url.pathname === "/api/providers") {
    const publicProviders = PROVIDERS.map(p => ({
      name: p.name,
      model: p.model // 可以把默认模型告诉前端
    }));
    return okJson(publicProviders);
  }

  // 生成
  if (url.pathname === "/generate" && req.method === "POST") {
    return handleGenerate(req);
  }

  // 反馈
  if (url.pathname === "/feedback" && req.method === "POST") {
    return req.json().then((b: any) => {
      const text = String(b?.text || "").trim();
      if (!text) return okJson({ error: "Empty" }, { status: 400 });
      console.log(new Date().toISOString(), "FEEDBACK", text.slice(0, 500));
      return okJson({ ok: true });
    });
  }

  // 静态资源：假设所有静态文件都在 'static' 文件夹内
  // 请确保你的 index.html, style.css, script.js, bao.jpg 都在一个名为 'static' 的文件夹里
  return serveDir(req, {
    fsRoot: "static",
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });
}

console.log(`Deno server running at http://localhost:${PORT}`);
serve(handler, { port: PORT });

// --- END OF REPLACEMENT FILE: main.ts ---