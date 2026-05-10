(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var fileId = params.get("file_id") || "";
  var fileName = document.getElementById("fileName");
  var viewer = document.getElementById("fileViewer");
  var fileKind = document.getElementById("fileKind");
  var fileSize = document.getElementById("fileSize");
  var fileCreatedAt = document.getElementById("fileCreatedAt");
  var message = document.getElementById("message");
  var download = document.getElementById("downloadFile");

  load();

  async function load() {
    if (!fileId) {
      message.textContent = "파일 정보가 없습니다.";
      return;
    }
    download.href = "/file/download/" + encodeURIComponent(fileId);
    try {
      var response = await fetch("/file/detail.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId })
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        message.textContent = body.message || "파일 정보를 불러오지 못했습니다.";
        return;
      }
      render(body.data);
    } catch (error) {
      message.textContent = "파일 정보를 불러오지 못했습니다.";
    }
  }

  function render(item) {
    var mediaPath = "/file/content/" + encodeURIComponent(item.file_id);
    fileName.textContent = item.file_name || "파일 상세";
    fileKind.textContent = Webhard.kindLabel(item.content_kind);
    fileSize.textContent = Webhard.formatSize(Number(item.file_size || 0));
    fileCreatedAt.textContent = Webhard.formatDateTime(item.original_created_at);
    if (item.content_kind === "VIDEO") {
      viewer.innerHTML = "<video class=\"detail-media\" src=\"" + mediaPath + "\" controls autoplay></video>";
      return;
    }
    if (item.content_kind === "IMAGE") {
      viewer.innerHTML = "<img class=\"detail-media\" src=\"" + mediaPath + "\" alt=\"\">";
      return;
    }
    viewer.innerHTML = "<div class=\"document-detail\">"
      + "<strong>" + escapeHtml(item.file_name || "문서 파일") + "</strong>"
      + "<span>브라우저 미리보기를 지원하지 않는 문서는 다운로드해서 확인하세요.</span>"
      + "</div>";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
