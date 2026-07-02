export default {
  async fetch(request, env, ctx) {
    // 1. Xử lý CORS preflight (cho phép gửi header tùy chỉnh X-Sync-Passcode)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sync-Passcode",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // 2. Xác thực mật mã bảo vệ (SYNC_PASSCODE) được cấu hình trên Cloudflare
      const clientPasscode = request.headers.get("X-Sync-Passcode");
      const serverPasscode = env.SYNC_PASSCODE; // Cần cấu hình trong Cloudflare settings

      if (serverPasscode && clientPasscode !== serverPasscode) {
        return new Response(
          JSON.stringify({ success: false, error: "Mật mã không chính xác. Bạn không có quyền đồng bộ." }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // 3. Lấy thông tin cấu hình từ Environment Variables của Worker
      const owner = env.GITHUB_OWNER || "thibui9394-web";
      const repo = env.GITHUB_REPO || "sheet-dashboard-24h";
      const workflowId = env.GITHUB_WORKFLOW_ID || "update-snapshot.yml";
      const githubToken = env.GITHUB_TOKEN;

      if (!githubToken) {
        return new Response(
          JSON.stringify({ error: "Lỗi: Chưa cấu hình Secret GITHUB_TOKEN trên Cloudflare Worker." }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // 4. Gửi lệnh sang GitHub
      const githubResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
        {
          method: "POST",
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Cloudflare-Worker-Dashboard-Sync",
          },
          body: JSON.stringify({
            ref: "main",
          }),
        }
      );

      if (githubResponse.status === 204) {
        return new Response(
          JSON.stringify({ success: true, message: "Kích hoạt đồng bộ thành công!" }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } else {
        const errorText = await githubResponse.text();
        return new Response(
          JSON.stringify({ success: false, error: `GitHub API error: ${errorText}` }),
          {
            status: githubResponse.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
