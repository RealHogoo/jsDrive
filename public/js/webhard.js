(function (global) {
  "use strict";

  var TOKEN_KEY = "webhard.accessToken";

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function saveToken(value) {
    localStorage.setItem(TOKEN_KEY, value || "");
  }

  function bindTokenBox() {
    var input = document.getElementById("token");
    var button = document.getElementById("saveToken");
    if (!input || !button) {
      return;
    }
    input.value = token();
    button.addEventListener("click", function () {
      saveToken(input.value.trim());
      button.textContent = "저장됨";
      setTimeout(function () {
        button.textContent = "저장";
      }, 1200);
    });
  }

  function authHeaders() {
    var value = token();
    return value ? { Authorization: "Bearer " + value } : {};
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

  function localDateTimeValue(date) {
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
      + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function mediaCard(item) {
    var mediaPath = item.file_id ? "/file/content/" + encodeURIComponent(item.file_id) : (item.public_path || "");
    var media = mediaPath
      ? mediaElement(item, mediaPath)
      : "<div class=\"preview-media missing-media\">미리보기 없음</div>";
    return "<article class=\"preview-card\">"
      + "<a class=\"media-link\" href=\"/file-detail.html?file_id=" + encodeURIComponent(item.file_id || "") + "\">" + media + "</a>"
      + "<div class=\"preview-meta\">"
      + "<div class=\"preview-name\">" + escapeHtml(item.file_name) + "</div>"
      + "<div>" + kindLabel(item.content_kind) + " / " + formatSize(Number(item.file_size || 0)) + "</div>"
      + "<div>원본 생성일 " + formatDateTime(item.original_created_at) + "</div>"
      + "</div>"
      + "</article>";
  }

  function mediaElement(item, publicPath) {
    if (item.content_kind === "VIDEO") {
      return "<video class=\"preview-media\" src=\"" + escapeAttr(publicPath) + "\" controls preload=\"metadata\"></video>";
    }
    if (item.content_kind === "IMAGE") {
      return "<img class=\"preview-media\" src=\"" + escapeAttr(publicPath) + "\" alt=\"\" loading=\"lazy\">";
    }
    return "<div class=\"preview-media document-preview\">"
      + "<span class=\"document-badge\">" + escapeHtml(fileExtension(item.file_name)) + "</span>"
      + "<strong>문서 파일</strong>"
      + "<small>상세 화면에서 다운로드</small>"
      + "</div>";
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
    bindTokenBox: bindTokenBox,
    authHeaders: authHeaders,
    formatDateTime: formatDateTime,
    localDateTimeValue: localDateTimeValue,
    mediaCard: mediaCard,
    kindLabel: kindLabel,
    formatSize: formatSize
  };
})(window);
