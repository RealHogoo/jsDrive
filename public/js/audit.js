(function () {
  "use strict";

  var list = document.getElementById("auditList");
  var summary = document.getElementById("auditSummary");
  var refreshButton = document.getElementById("refreshAudit");
  var loadMoreButton = document.getElementById("loadMoreAudit");
  var allUsersWrap = document.getElementById("allUsersWrap");
  var allUsers = document.getElementById("allUsers");
  var dateFrom = document.getElementById("dateFrom");
  var dateTo = document.getElementById("dateTo");
  var actionFilter = document.getElementById("actionFilter");
  var targetType = document.getElementById("targetType");
  var actorUserId = document.getElementById("actorUserId");
  var offset = 0;
  var hasMore = true;

  refreshButton.addEventListener("click", reset);
  loadMoreButton.addEventListener("click", loadMore);
  allUsers.addEventListener("change", reset);
  [dateFrom, dateTo, actionFilter, targetType].forEach(function (element) {
    element.addEventListener("change", reset);
  });
  actorUserId.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      reset();
    }
  });

  Webhard.currentUser().then(function (user) {
    allUsersWrap.hidden = user && user.is_admin !== true;
    reset();
  });

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
      var data = await Webhard.postJson("/audit/list.json", {
        offset: offset,
        limit: 30,
        all_users: allUsers.checked,
        date_from: dateFrom.value,
        date_to: dateTo.value,
        action_cd: actionFilter.value,
        target_type: targetType.value,
        actor_user_id: actorUserId.value
      });
      var items = data.items || [];
      if (items.length > 0) {
        list.insertAdjacentHTML("beforeend", items.map(row).join(""));
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      loadMoreButton.hidden = !hasMore;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "기록이 없습니다.";
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  function row(item) {
    return "<article class=\"management-row\">"
      + "<div><strong>" + escapeHtml(actionLabel(item.action_cd)) + "</strong><span>" + escapeHtml(detailText(item.detail_json)) + "</span></div>"
      + "<span>" + escapeHtml(item.actor_user_id || "-") + "</span>"
      + "<span>" + escapeHtml(item.target_type || "-") + " #" + escapeHtml(item.target_id || "-") + "</span>"
      + "<span>" + Webhard.formatDateTime(item.created_at) + "</span>"
      + "</article>";
  }

  function actionLabel(value) {
    return String(value || "-").replace(/_/g, " ");
  }

  function detailText(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
