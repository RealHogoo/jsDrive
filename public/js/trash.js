(function () {
  "use strict";

  var grid = document.getElementById("trashGrid");
  var summary = document.getElementById("trashSummary");
  var sentinel = document.getElementById("trashSentinel");
  var purgeOldButton = document.getElementById("purgeOld");
  var offset = 0;
  var loading = false;
  var hasMore = true;

  grid.addEventListener("click", handleClick);
  purgeOldButton.addEventListener("click", purgeOld);
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
      var data = await Webhard.postJson("/trash/list.json", { offset: offset, limit: 20 });
      var items = data.items || [];
      if (items.length > 0) {
        grid.insertAdjacentHTML("beforeend", items.map(trashCard).join(""));
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "휴지통이 비어 있습니다.";
      sentinel.textContent = hasMore ? "아래로 스크롤하면 더 불러옵니다." : "";
    } catch (error) {
      sentinel.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  function trashCard(item) {
    return "<article class=\"preview-card\" data-file-id=\"" + encodeURIComponent(item.file_id || "") + "\">"
      + "<div class=\"preview-media document-preview\">"
      + "<span class=\"document-badge\">" + Webhard.kindLabel(item.content_kind).slice(0, 4) + "</span>"
      + "<strong>삭제된 파일</strong>"
      + "</div>"
      + "<div class=\"preview-meta\">"
      + "<div class=\"preview-name\">" + escapeHtml(item.file_name) + "</div>"
      + "<div>" + Webhard.kindLabel(item.content_kind) + " / " + Webhard.formatSize(Number(item.file_size || 0)) + "</div>"
      + "<div>삭제일 " + Webhard.formatDateTime(item.deleted_at) + "</div>"
      + "<div class=\"card-actions\">"
      + "<button class=\"btn\" type=\"button\" data-action=\"restore\" data-file-id=\"" + encodeURIComponent(item.file_id || "") + "\">복원</button>"
      + "<button class=\"btn danger\" type=\"button\" data-action=\"purge\" data-file-id=\"" + encodeURIComponent(item.file_id || "") + "\">완전 삭제</button>"
      + "</div>"
      + "</div>"
      + "</article>";
  }

  async function handleClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    var action = button.getAttribute("data-action");
    var fileId = button.getAttribute("data-file-id");
    try {
      if (action === "restore") {
        await Webhard.postJson("/trash/restore.json", { file_id: fileId });
        removeCard(button);
        summary.textContent = "파일을 복원했습니다.";
      }
      if (action === "purge" && window.confirm("파일을 완전히 삭제할까요?")) {
        await Webhard.postJson("/trash/purge.json", { file_id: fileId });
        removeCard(button);
        summary.textContent = "파일을 완전히 삭제했습니다.";
      }
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  async function purgeOld() {
    var retentionDays = Number(document.getElementById("retentionDays").value || 30);
    if (!window.confirm(retentionDays + "일보다 오래된 휴지통 파일을 정리할까요?")) {
      return;
    }
    try {
      var data = await Webhard.postJson("/trash/purge-old.json", { retention_days: retentionDays });
      summary.textContent = data.purged_count + "개를 정리했습니다.";
      grid.innerHTML = "";
      offset = 0;
      hasMore = true;
      loadMore();
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  function removeCard(button) {
    var card = button.closest(".preview-card");
    if (card) {
      card.remove();
    }
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
