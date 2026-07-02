export default {
  async fetch(request, env, ctx) {
    // 1. Xử lý CORS preflight (cho phép gọi API trực tiếp từ trình duyệt bất kỳ tên miền nào)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // 2. Lấy thông tin cấu hình từ Environment Variables của Worker
      // Mặc định cấu hình cho tài khoản của bạn, bạn có thể đổi lại trong dashboard của Cloudflare
      const owner = env.GITHUB_OWNER || "thibui9394-web";
      const repo = env.GITHUB_REPO || "sheet-dashboard-24h";
      const workflowId = env.GITHUB_WORKFLOW_ID || "update-snapshot.yml";
      const githubToken = env.GITHUB_TOKEN; // Cần được cấu hình làm Secret trong Cloudflare Worker

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

      // 3. Gửi lệnh Dispatch sang GitHub Actions để bắt đầu quét dữ liệu
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
            ref: "main", // Chạy trên nhánh chính
          }),
        }
      );

      // GitHub API trả về 204 No Content khi kích hoạt thành công
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
