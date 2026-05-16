(function () {
  "use strict";

  var list = document.getElementById("downloadList");
  var summary = document.getElementById("downloadSummary");
  var sentinel = document.getElementById("downloadSentinel");
  var offset = 0;
  var loading = false;
  var hasMore = true;

  window.addEventListener("scroll", function () {
    if (isPageBottom()) {
      loadMore();
    }
  }, { passive: true });

  loadMore();

  async function loadMore() {
    if (loading || !hasMore) {
      return;
    }
    loading = true;
    sentinel.textContent = "불러오는 중입니다.";
    try {
      var data = await Webhard.postJson("/download/list.json", { offset: offset, limit: 20 });
      var items = data.items || [];
      if (items.length > 0) {
        list.insertAdjacentHTML("beforeend", items.map(jobRow).join(""));
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "다운로드 작업이 없습니다.";
      sentinel.textContent = hasMore ? "아래로 스크롤하면 더 불러옵니다." : "";
    } catch (error) {
      sentinel.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  function jobRow(item) {
    var status = escapeHtml(item.status_cd || "-");
    var download = item.status_cd === "DONE"
      ? "<a class=\"btn\" href=\"/download/file/" + encodeURIComponent(item.job_id) + "\">받기</a>"
      : "";
    return "<article class=\"job-row\">"
      + "<div><strong>#" + escapeHtml(item.job_id) + " " + status + "</strong>"
      + "<div class=\"summary\">" + escapeHtml(item.week_start || "-") + " / " + escapeHtml(item.sort_basis || "-") + "</div></div>"
      + "<div>" + Number(item.processed_count || 0) + " / " + Number(item.total_count || 0) + "</div>"
      + "<div>" + Webhard.formatSize(Number(item.total_bytes || 0)) + "</div>"
      + "<div>" + escapeHtml(item.message || "-") + "</div>"
      + "<div>" + Webhard.formatDateTime(item.updated_at) + "</div>"
      + "<div>" + download + "</div>"
      + "</article>";
  }

  function isPageBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 12;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
