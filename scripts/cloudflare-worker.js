export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sync-Passcode",
    };
    const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

    // 1. Xử lý CORS preflight (cho phép gửi header tùy chỉnh X-Sync-Passcode)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, status: "method_not_allowed", error: "Chỉ hỗ trợ phương thức POST." }, 405);
    }

    try {
      // 2. Xác thực mật mã bảo vệ (SYNC_PASSCODE) được cấu hình trên Cloudflare
      const clientPasscode = request.headers.get("X-Sync-Passcode");
      const serverPasscode = env.SYNC_PASSCODE; // Cần cấu hình trong Cloudflare settings

      // Fail closed: tuyệt đối không cho dispatch công khai nếu Worker bị thiếu
      // secret bảo vệ do cấu hình/deploy nhầm.
      if (!serverPasscode) {
        return jsonResponse({
          success: false,
          status: "configuration_error",
          error: "Worker chưa được cấu hình SYNC_PASSCODE.",
        }, 500);
      }

      if (!clientPasscode || clientPasscode !== serverPasscode) {
        return jsonResponse({
          success: false,
          status: "unauthorized",
          error: "Mật mã không chính xác. Bạn không có quyền đồng bộ.",
        }, 401);
      }

      // 3. Lấy thông tin cấu hình từ Environment Variables của Worker
      const owner = env.GITHUB_OWNER || "thibui9394-web";
      const repo = env.GITHUB_REPO || "sheet-dashboard-24h";
      const workflowId = env.GITHUB_WORKFLOW_ID || "update-snapshot.yml";
      const githubToken = env.GITHUB_TOKEN;

      if (!githubToken) {
        return jsonResponse({
          success: false,
          status: "configuration_error",
          error: "Worker chưa được cấu hình GITHUB_TOKEN.",
        }, 500);
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
            // Dashboard luôn yêu cầu full scan để mọi thao tác chèn, xóa, dời
            // và sửa dòng (kể cả tháng cũ) được phản ánh chính xác.
            inputs: {
              scan_all: "true",
            },
          }),
        }
      );

      if (githubResponse.status === 204) {
        return jsonResponse({
          success: true,
          status: "accepted",
          scope: "full",
          message: "GitHub đã nhận yêu cầu quét toàn bộ Sheet.",
          workflowUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflowId}`,
        }, 202);
      } else {
        const errorText = await githubResponse.text();
        return jsonResponse({
          success: false,
          status: "rejected",
          error: `GitHub API error: ${errorText}`,
        }, githubResponse.status);
      }
    } catch (err) {
      return jsonResponse({ success: false, status: "error", error: err.message }, 500);
    }
  },
};
