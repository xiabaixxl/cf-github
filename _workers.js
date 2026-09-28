/**
 * Cloudflare Worker GitHub 网页与文件全功能加速代理（生产优化版）
 */

const TARGET_HOST = 'github.com';

// 允许代理的所有相关 GitHub 域名白名单
const ALLOWED_HOSTS = [
  'github.com',
  'raw.githubusercontent.com',
  'assets.github.com',
  'camo.githubusercontent.com',
  'github.githubassets.com',
  'codeload.github.com'
];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // 1. 根目录显示优雅的引导首页
  if (url.pathname === '/') {
    return new Response(getHomepageHTML(url.host), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    })
  }

  let targetUrlStr = url.pathname.replace(/^\/+/, '')
  
  // 兼容直接输入路径或完整 URL
  if (!targetUrlStr.startsWith('http://') && !targetUrlStr.startsWith('https://')) {
    targetUrlStr = `https://${TARGET_HOST}/` + targetUrlStr
  }
  if (url.search) {
    targetUrlStr += url.search
  }

  try {
    const targetUrl = new URL(targetUrlStr)

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response(`Error: Host not allowed -> ${targetUrl.hostname}`, { status: 403 })
    }

    // 2. 构造贴近真实浏览器的请求头
    const newHeaders = new Headers(request.headers)
    newHeaders.set('Host', targetUrl.hostname)
    newHeaders.set('Referer', `https://${targetUrl.hostname}/`)
    newHeaders.set('Origin', `https://${targetUrl.hostname}`)
    
    // 移除可能引起 Cloudflare 边缘触发人机验证或压缩异常的头
    newHeaders.delete('CF-Connecting-IP')
    newHeaders.delete('CF-IPCountry')
    newHeaders.delete('CF-RAY')
    newHeaders.delete('CF-Visitor')

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual' // 手动托管重定向
    })

    const response = await fetch(modifiedRequest)

    // 3. 增强版 3X0 重定向处理（自动将跳转地址包裹进代理）
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location')
      if (location) {
        let newLocation = location
        try {
          const locUrl = new URL(location, targetUrl)
          if (ALLOWED_HOSTS.includes(locUrl.hostname)) {
            newLocation = `https://${url.host}/${locUrl.toString()}`
          }
        } catch (e) {
          newLocation = `https://${url.host}/https://${targetUrl.hostname}${location}`
        }
        
        const newResponse = new Response(response.body, response)
        newResponse.headers.set('Location', newLocation)
        return newResponse
      }
    }

    // 4. 复制响应并剥离 CSP 限制，防止浏览器拦截代理脚本/样式
    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('Content-Security-Policy')
    responseHeaders.delete('Content-Security-Policy-Report-Only')
    responseHeaders.set('Access-Control-Allow-Origin', '*')

    // 5. 如果是 HTML 网页，利用 HTMLRewriter 进行流式链接重写
    const contentType = responseHeaders.get('Content-Type') || ''
    if (contentType.includes('text/html')) {
      const rewrittenResponse = rewriter(url.host).transform(new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      }))
      return rewrittenResponse
    }

    // 6. 其他静态文件、图片、API 直接透传
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    })

  } catch (err) {
    return new Response('Proxy Gateway Error: ' + err.message, { status: 500 })
  }
}

/**
 * 针对 HTML 标签属性的高效重写器
 */
function rewriter(workerHost) {
  class ElementHandler {
    element(element) {
      const attributes = ['href', 'src', 'action', 'data-url', 'data-src', 'cite']
      for (const attr of attributes) {
        const val = element.getAttribute(attr)
        if (val) {
          element.setAttribute(attr, resolveUrl(val, workerHost))
        }
      }
    }
  }

  return new HTMLRewriter()
    .on('a', new ElementHandler())
    .on('link', new ElementHandler())
    .on('script', new ElementHandler())
    .on('img', new ElementHandler())
    .on('form', new ElementHandler())
    .on('source', new ElementHandler())
    .on('meta', new ElementHandler())
}

/**
 * 将各类绝对/相对链接安全地转换为代理链接
 */
function resolveUrl(originalUrl, workerHost) {
  try {
    if (originalUrl.startsWith('#') || originalUrl.startsWith('javascript:') || originalUrl.startsWith('mailto:')) {
      return originalUrl
    }
    
    // 处理根路径开头的链接 (如 /login)
    if (originalUrl.startsWith('/') && !originalUrl.startsWith('//')) {
      return `https://${workerHost}/https://${TARGET_HOST}${originalUrl}`
    }

    const parsed = new URL(originalUrl)
    if (ALLOWED_HOSTS.includes(parsed.hostname)) {
      return `https://${workerHost}/${parsed.toString()}`
    }
  } catch (e) {
    // 无法解析的相对路径尝试安全拼接
    if (originalUrl.startsWith('/')) {
      return `https://${workerHost}/https://${TARGET_HOST}${originalUrl}`
    }
  }
  return originalUrl
}

function getHomepageHTML(host) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub Accelerator</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 650px; margin: 80px auto; padding: 0 20px; color: #24292e; line-height: 1.6; background: #f6f8fa; }
        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e1e4e8; }
        h2 { margin-top: 0; color: #0366d6; }
        input { width: 100%; padding: 12px 15px; font-size: 16px; margin: 15px 0 20px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; outline: none; transition: border 0.2s; }
        input:focus { border-color: #0366d6; box-shadow: 0 0 0 3px rgba(3,102,214,0.1); }
        button { background: #2ea44f; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%; transition: background 0.2s; }
        button:hover { background: #2c974b; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 6px; border: 1px solid #e1e4e8; overflow-x: auto; font-size: 13px; }
        .tips { margin-top: 25px; font-size: 14px; color: #586069; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🚀 GitHub 网页全功能加速</h2>
        <p>输入您想访问的仓库、用户或文件链接：</p>
        <input type="text" id="target" placeholder="https://github.com/torvalds/linux" />
        <button onclick="go()">立即访问加速页</button>
        
        <div class="tips">
            <p><strong>地址栏直接拼接格式：</strong></p>
            <pre>https://${host}/https://github.com/用户名/仓库名</pre>
        </div>
    </div>
    <script>
        function go() {
            let val = document.getElementById('target').value.trim();
            if(val) {
                window.location.href = 'https://${host}/' + val;
            }
        }
    </script>
</body>
</html>`
}