(function () {
  "use strict";

  Webhard.bindTokenBox();

  var periodType = document.getElementById("periodType");
  var baseDate = document.getElementById("baseDate");
  var contentKind = document.getElementById("contentKind");
  var search = document.getElementById("search");
  var summary = document.getElementById("summary");
  var grid = document.getElementById("previewGrid");

  baseDate.value = new Date().toISOString().slice(0, 10);
  search.addEventListener("click", load);
  load();

  async function load() {
    summary.textContent = "조회 중입니다.";
    grid.innerHTML = "";
    try {
      var response = await fetch("/preview/list.json", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, Webhard.authHeaders()),
        body: JSON.stringify({
          period_type: periodType.value,
          base_date: baseDate.value,
          content_kind: contentKind.value
        })
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        summary.textContent = body.message || "조회에 실패했습니다.";
        return;
      }
      render(body.data);
    } catch (error) {
      summary.textContent = "조회 요청에 실패했습니다.";
    }
  }

  function render(data) {
    var items = data.items || [];
    summary.textContent = data.start_date.slice(0, 10) + " ~ " + data.end_date.slice(0, 10)
      + " / " + items.length + "개";
    if (items.length === 0) {
      grid.innerHTML = "<div class=\"empty\">원본 생성일 기준으로 표시할 파일이 없습니다.</div>";
      return;
    }
    grid.innerHTML = items.map(card).join("");
  }

  function card(item) {
    var media = item.content_kind === "VIDEO"
      ? "<video class=\"preview-media\" src=\"" + escapeAttr(item.public_path) + "\" controls preload=\"metadata\"></video>"
      : "<img class=\"preview-media\" src=\"" + escapeAttr(item.public_path) + "\" alt=\"\">";
    return "<article class=\"preview-card\">"
      + media
      + "<div class=\"preview-meta\">"
      + "<div class=\"preview-name\">" + escapeHtml(item.file_name) + "</div>"
      + "<div>" + item.content_kind + " / " + formatSize(Number(item.file_size || 0)) + "</div>"
      + "<div>원본 생성일: " + Webhard.formatDateTime(item.original_created_at) + "</div>"
      + "</div>"
      + "</article>";
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
})();
