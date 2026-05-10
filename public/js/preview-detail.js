(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var weekStart = params.get("week_start") || "";
  var initialKind = params.get("content_kind") || "ALL";
  var initialSortBasis = params.get("sort_basis") || "UPLOADED";
  var label = params.get("label") || weekStart;
  var contentKind = document.getElementById("contentKind");
  var sortBasis = document.getElementById("sortBasis");
  var title = document.getElementById("detailTitle");
  var summary = document.getElementById("detailSummary");
  var grid = document.getElementById("detailGrid");
  var sentinel = document.getElementById("detailSentinel");
  var downloadWeek = document.getElementById("downloadWeek");
  var offset = 0;
  var loading = false;
  var hasMore = true;

  title.textContent = label;
  contentKind.value = initialKind;
  sortBasis.value = initialSortBasis;
  setDownloadUrl();
  contentKind.addEventListener("change", resetAndLoad);
  sortBasis.addEventListener("change", resetAndLoad);

  window.addEventListener("scroll", function () {
    if (isPageBottom()) {
      loadMore();
    }
  }, { passive: true });

  resetAndLoad();

  function resetAndLoad() {
    setDownloadUrl();
    offset = 0;
    hasMore = true;
    loading = false;
    grid.innerHTML = "";
    summary.textContent = "";
    sentinel.textContent = "불러오는 중입니다.";
    loadMore();
  }

  function setDownloadUrl() {
    downloadWeek.href = "/file/week-download?week_start=" + encodeURIComponent(weekStart)
      + "&content_kind=" + encodeURIComponent(contentKind.value)
      + "&sort_basis=" + encodeURIComponent(sortBasis.value);
  }

  async function loadMore() {
    if (loading || !hasMore) {
      return;
    }
    if (!weekStart) {
      summary.textContent = "주차 정보가 없습니다.";
      sentinel.textContent = "";
      hasMore = false;
      return;
    }
    loading = true;
    sentinel.textContent = "불러오는 중입니다.";
    try {
      var response = await fetch("/preview/week-items.json", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, Webhard.authHeaders()),
        body: JSON.stringify({
          week_start: weekStart,
          offset: offset,
          limit: 10,
          content_kind: contentKind.value,
          sort_basis: sortBasis.value
        })
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        summary.textContent = body.message || "상세 목록을 불러오지 못했습니다.";
        sentinel.textContent = "";
        return;
      }
      var items = body.data.items || [];
      if (items.length > 0) {
        grid.insertAdjacentHTML("beforeend", items.map(Webhard.mediaCard).join(""));
      }
      offset = body.data.next_offset || offset + items.length;
      hasMore = body.data.has_more === true;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "표시할 파일이 없습니다.";
      sentinel.textContent = hasMore ? "아래로 스크롤하면 다음 10개를 불러옵니다." : "";
    } catch (error) {
      summary.textContent = "상세 목록을 불러오지 못했습니다.";
      sentinel.textContent = "";
    } finally {
      loading = false;
    }
  }

  function isPageBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 12;
  }
})();
