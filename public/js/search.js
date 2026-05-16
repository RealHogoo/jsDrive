(function () {
  "use strict";

  var grid = document.getElementById("searchGrid");
  var summary = document.getElementById("searchSummary");
  var sentinel = document.getElementById("searchSentinel");
  var button = document.getElementById("searchButton");
  var offset = 0;
  var loading = false;
  var hasMore = true;

  button.addEventListener("click", resetAndLoad);
  window.addEventListener("scroll", function () {
    if (isPageBottom()) {
      loadMore();
    }
  }, { passive: true });

  resetAndLoad();

  function criteria() {
    return {
      keyword: document.getElementById("keyword").value,
      content_kind: document.getElementById("contentKind").value,
      sort_basis: document.getElementById("sortBasis").value,
      date_from: document.getElementById("dateFrom").value,
      date_to: document.getElementById("dateTo").value
    };
  }

  function resetAndLoad() {
    offset = 0;
    hasMore = true;
    grid.innerHTML = "";
    loadMore();
  }

  async function loadMore() {
    if (loading || !hasMore) {
      return;
    }
    loading = true;
    sentinel.textContent = "불러오는 중입니다.";
    try {
      var payload = criteria();
      payload.offset = offset;
      payload.limit = 20;
      var data = await Webhard.postJson("/file/search.json", payload);
      var items = data.items || [];
      if (items.length > 0) {
        grid.insertAdjacentHTML("beforeend", items.map(Webhard.mediaCard).join(""));
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "검색 결과가 없습니다.";
      sentinel.textContent = hasMore ? "아래로 스크롤하면 더 불러옵니다." : "";
    } catch (error) {
      sentinel.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  function isPageBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 12;
  }
})();
