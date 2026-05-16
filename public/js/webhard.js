(function (global) {
  "use strict";

  function authHeaders() {
    return {};
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("ko-KR", { hour12: false });
  }

  function mediaCard(item) {
    var mediaPath = item.file_id ? "/file/content/" + encodeURIComponent(item.file_id) : "";
    var media = mediaPath
      ? mediaElement(item, mediaPath)
      : "<div class=\"preview-media missing-media\">미리보기 없음</div>";
    return "<article class=\"preview-card\" data-file-id=\"" + encodeURIComponent(item.file_id || "") + "\">"
      + "<a class=\"media-link\" href=\"/file-detail.html?file_id=" + encodeURIComponent(item.file_id || "") + "\">" + media + "</a>"
      + "<div class=\"preview-meta\">"
      + "<div class=\"preview-name\">" + escapeHtml(item.file_name) + "</div>"
      + "<div>" + kindLabel(item.content_kind) + " / " + formatSize(Number(item.file_size || 0)) + "</div>"
      + "<div>원본 생성일 " + formatDateTime(item.original_created_at) + "</div>"
      + "<div class=\"card-actions\">"
      + "<button class=\"btn danger\" type=\"button\" data-action=\"delete-file\" data-file-id=\"" + encodeURIComponent(item.file_id || "") + "\">삭제</button>"
      + "</div>"
      + "</div>"
      + "</article>";
  }

  function mediaElement(item, publicPath) {
    if (item.content_kind === "VIDEO") {
      var videoPoster = item.thumbnail_path && item.file_id
        ? " poster=\"/file/thumbnail/" + encodeURIComponent(item.file_id) + "\""
        : "";
      return "<video class=\"preview-media\" src=\"" + escapeAttr(publicPath) + "\" controls preload=\"metadata\"" + videoPoster + "></video>";
    }
    if (item.content_kind === "IMAGE") {
      var thumbnailPath = item.thumbnail_path && item.file_id
        ? "/file/thumbnail/" + encodeURIComponent(item.file_id)
        : publicPath;
      return "<img class=\"preview-media\" src=\"" + escapeAttr(thumbnailPath) + "\" alt=\"\" loading=\"lazy\">";
    }
    return "<div class=\"preview-media document-preview\">"
      + "<span class=\"document-badge\">" + escapeHtml(fileExtension(item.file_name)) + "</span>"
      + "<strong>문서 파일</strong>"
      + "<small>상세 화면에서 다운로드</small>"
      + "</div>";
  }

  async function postJson(url, body) {
    var response = await fetch(url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify(body || {})
    });
    var data = await response.json();
    if (!response.ok || data.ok !== true) {
      throw new Error(data.message || "요청에 실패했습니다.");
    }
    return data.data;
  }

  function kindLabel(kind) {
    if (kind === "IMAGE") {
      return "사진";
    }
    if (kind === "VIDEO") {
      return "동영상";
    }
    if (kind === "DOCUMENT") {
      return "문서";
    }
    return String(kind || "-");
  }

  function fileExtension(fileName) {
    var match = String(fileName || "").match(/\.([^.]+)$/);
    return match ? match[1].toUpperCase().slice(0, 8) : "DOC";
  }

  function formatSize(size) {
    if (size >= 1024 * 1024 * 1024) {
      return (size / 1024 / 1024 / 1024).toFixed(1) + " GB";
    }
    if (size >= 1024 * 1024) {
      return (size / 1024 / 1024).toFixed(1) + " MB";
    }
    if (size >= 1024) {
      return (size / 1024).toFixed(1) + " KB";
    }
    return size + " B";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  global.Webhard = {
    authHeaders: authHeaders,
    formatDateTime: formatDateTime,
    mediaCard: mediaCard,
    postJson: postJson,
    kindLabel: kindLabel,
    formatSize: formatSize
  };
})(window);
