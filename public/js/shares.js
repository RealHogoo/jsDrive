(function () {
  "use strict";

  var list = document.getElementById("shareList");
  var summary = document.getElementById("shareSummary");
  var refreshButton = document.getElementById("refreshShares");
  var loadMoreButton = document.getElementById("loadMoreShares");
  var offset = 0;
  var hasMore = true;

  refreshButton.addEventListener("click", reset);
  loadMoreButton.addEventListener("click", loadMore);
  list.addEventListener("click", handleClick);

  reset();

  function reset() {
    offset = 0;
    hasMore = true;
    list.innerHTML = "";
    loadMore();
  }

  async function loadMore() {
    if (!hasMore) {
      return;
    }
    summary.textContent = "불러오는 중입니다.";
    try {
      var data = await Webhard.postJson("/share/list.json", { offset: offset, limit: 20 });
      var items = data.items || [];
      if (items.length > 0) {
        list.insertAdjacentHTML("beforeend", items.map(row).join(""));
        Webhard.applyPermissions(list);
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      loadMoreButton.hidden = !hasMore;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "공유 링크가 없습니다.";
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  function row(item) {
    var name = item.display_name || item.file_name || item.folder_name || "-";
    var url = "/s/" + encodeURIComponent(item.share_token || "");
    var status = item.revoked_yn === "Y" ? "해지됨" : "활성";
    var revokeButton = item.revoked_yn === "Y" ? "" : "<button class=\"btn danger\" type=\"button\" data-permission=\"share\" data-action=\"revoke\">해지</button>";
    return "<article class=\"management-row\" data-share-id=\"" + escapeAttr(item.share_id) + "\">"
      + "<div><strong>" + escapeHtml(name) + "</strong><span>" + escapeHtml(url) + "</span></div>"
      + "<span>" + status + "</span>"
      + "<span>" + Webhard.formatDateTime(item.created_at) + "</span>"
      + "<span>다운로드 " + escapeHtml(item.download_count || 0) + "</span>"
      + "<div class=\"card-actions\">"
      + "<button class=\"btn\" type=\"button\" data-action=\"copy\" data-url=\"" + escapeAttr(url) + "\">복사</button>"
      + revokeButton
      + "</div>"
      + "</article>";
  }

  async function handleClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    var rowElement = button.closest("[data-share-id]");
    var action = button.getAttribute("data-action");
    if (action === "copy") {
      await navigator.clipboard.writeText(window.location.origin + button.getAttribute("data-url"));
      summary.textContent = "공유 링크를 복사했습니다.";
      return;
    }
    if (action === "revoke" && window.confirm("공유 링크를 해지할까요?")) {
      await Webhard.postJson("/share/revoke.json", { share_id: rowElement.getAttribute("data-share-id") });
      reset();
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
})();
