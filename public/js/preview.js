(function () {
  "use strict";

  var contentKind = document.getElementById("contentKind");
  var sortBasis = document.getElementById("sortBasis");
  var summary = document.getElementById("summary");
  var feed = document.getElementById("previewFeed");
  var sentinel = document.getElementById("feedSentinel");
  var cursorDate = null;
  var loading = false;
  var hasMoreFeed = true;
  var loadedWeeks = 0;

  contentKind.addEventListener("change", resetAndLoad);
  sortBasis.addEventListener("change", resetAndLoad);
  feed.addEventListener("click", handleFeedClick);

  window.addEventListener("scroll", function () {
    if (isPageBottom()) {
      loadMoreFeed();
    }
  }, { passive: true });

  resetAndLoad();

  function resetAndLoad() {
    cursorDate = null;
    loading = false;
    hasMoreFeed = true;
    loadedWeeks = 0;
    feed.innerHTML = "";
    summary.textContent = "";
    sentinel.textContent = "불러오는 중입니다.";
    loadMoreFeed();
  }

  async function loadMoreFeed() {
    if (loading || !hasMoreFeed) {
      return;
    }
    loading = true;
    sentinel.textContent = "불러오는 중입니다.";
    try {
      var data = await Webhard.postJson("/preview/feed.json", {
        cursor_date: cursorDate,
        weeks: 5,
        content_kind: contentKind.value,
        sort_basis: sortBasis.value
      });
      renderWeeks(data);
      cursorDate = data.next_cursor_date;
      hasMoreFeed = data.has_more === true && !!cursorDate;
      sentinel.textContent = hasMoreFeed ? "아래로 스크롤하면 이전 5개 주차를 더 불러옵니다." : "더 표시할 파일이 없습니다.";
    } catch (error) {
      sentinel.textContent = error.message || "파일을 불러오지 못했습니다.";
    } finally {
      loading = false;
    }
  }

  function renderWeeks(data) {
    var weeks = data.weeks || [];
    weeks.forEach(function (week) {
      feed.insertAdjacentHTML("beforeend", weekSection(week));
    });
    loadedWeeks += weeks.length;
    var cardCount = feed.querySelectorAll(".preview-card").length;
    summary.textContent = loadedWeeks > 0
      ? "파일이 있는 " + loadedWeeks + "개 주차 / 미리보기 " + cardCount + "개"
      : "표시할 파일이 없습니다.";
  }

  function weekSection(week) {
    var items = week.items || [];
    var weekStart = String(week.week_start || "").slice(0, 10);
    var detailUrl = "/preview-detail.html?week_start=" + encodeURIComponent(weekStart)
      + "&content_kind=" + encodeURIComponent(contentKind.value)
      + "&sort_basis=" + encodeURIComponent(sortBasis.value)
      + "&label=" + encodeURIComponent(week.label || "");
    var zipUrl = "/file/week-download?week_start=" + encodeURIComponent(weekStart)
      + "&content_kind=" + encodeURIComponent(contentKind.value)
      + "&sort_basis=" + encodeURIComponent(sortBasis.value);
    return "<section class=\"week-section\">"
      + "<div class=\"week-title\">"
      + "<div>"
      + "<h2>" + escapeHtml(week.label) + "</h2>"
      + "<span>" + Number(week.item_count || items.length) + "개</span>"
      + "</div>"
      + "<div class=\"week-actions\">"
      + "<a class=\"btn\" href=\"" + escapeAttr(zipUrl) + "\">일괄 다운로드</a>"
      + "<a class=\"btn\" href=\"" + escapeAttr(detailUrl) + "\">더보기</a>"
      + "</div>"
      + "</div>"
      + "<div class=\"preview-slider\">" + items.map(Webhard.mediaCard).join("") + "</div>"
      + "</section>";
  }

  async function handleFeedClick(event) {
    var button = event.target.closest("[data-action=\"delete-file\"]");
    if (!button) {
      return;
    }
    event.preventDefault();
    if (!window.confirm("파일을 휴지통으로 이동할까요?")) {
      return;
    }
    try {
      await Webhard.postJson("/file/delete.json", { file_id: button.getAttribute("data-file-id") });
      var card = button.closest(".preview-card");
      if (card) {
        card.remove();
      }
      summary.textContent = "파일을 휴지통으로 이동했습니다.";
    } catch (error) {
      summary.textContent = error.message;
    }
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

  function isPageBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 12;
  }
})();
