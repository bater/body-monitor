import "./style.css";
import { api, onInviteRequired } from "./api";
import { h } from "./ui";
import { renderDashboard } from "./pages/dashboard";
import { renderFood } from "./pages/food";
import { renderWorkout } from "./pages/workout";
import { renderInBody } from "./pages/inbody";
import { renderExercises } from "./pages/exercises";
import { renderExerciseDetail } from "./pages/exercise-detail";
import { renderSettings } from "./pages/settings";
import { renderAbout } from "./pages/about";
import { renderAdmin } from "./pages/admin";

const routes: Record<string, (page: HTMLElement) => void> = {
  "": renderDashboard,
  food: renderFood,
  workout: renderWorkout,
  inbody: renderInBody,
  exercises: renderExercises,
  exercise: renderExerciseDetail,
  settings: renderSettings,
  about: renderAbout,
  admin: renderAdmin,
};

function currentRoute(): string {
  return location.hash.replace(/^#\/?/, "").split("?")[0];
}

function render() {
  const page = document.getElementById("page")!;
  const route = currentRoute();
  const view = routes[route] ?? renderDashboard;
  window.scrollTo(0, 0);
  view(page);
  // routes without their own tab highlight the closest one
  const tabRoute =
    route === "exercises" || route === "exercise"
      ? "workout"
      : route === "about"
        ? "settings"
        : route in routes
          ? route
          : "";
  document.querySelectorAll<HTMLAnchorElement>("#tabbar a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === tabRoute);
  });
}

// ---- invite gate ----

const inviteToken = new URLSearchParams(location.search).get("invite");
let gateShown = false;

function showBlocked(logoutUrl: string | null, message?: string) {
  if (gateShown) return;
  gateShown = true;
  document.getElementById("tabbar")!.style.display = "none";
  document.getElementById("page")!.replaceChildren(
    h(
      "div",
      { class: "card", style: "margin-top:24px;text-align:center" },
      h("div", { class: "eyebrow" }, "尚未受邀"),
      h("p", { style: "margin:10px 0" }, message ?? "此帳號尚未受邀，請向管理員索取邀請連結。"),
      logoutUrl
        ? h("a", { href: logoutUrl, class: "btn", style: "text-decoration:none;margin-top:8px" }, "登出，換個帳號")
        : null
    )
  );
}

onInviteRequired((logoutUrl) => {
  if (inviteToken) {
    // authenticated newcomer arriving via an invite link — redeem it
    document.getElementById("page")!.replaceChildren(
      h("div", { class: "empty" }, "正在建立你的帳號…")
    );
    api
      .post<{ ok: boolean }>("/api/invite/redeem", { token: inviteToken })
      .then(() => {
        history.replaceState(null, "", location.pathname);
        location.reload();
      })
      .catch((e) => showBlocked(logoutUrl, e instanceof Error ? e.message : undefined));
  } else {
    showBlocked(logoutUrl);
  }
});

// existing members arriving with a leftover ?invite= param: clean it up quietly
if (inviteToken) {
  void api
    .get("/api/me")
    .then(() => history.replaceState(null, "", location.pathname))
    .catch(() => {
      /* gate handler takes over */
    });
}

// ---- topbar user chip: Google avatar + name from Access, fallback to /api/me ----

async function loadUserChip() {
  const chip = document.getElementById("user-chip");
  if (!chip) return;

  const pick = (o: unknown, k: string): string => {
    const v = (o as Record<string, unknown> | null | undefined)?.[k];
    return typeof v === "string" ? v : "";
  };

  let name = "";
  let picture = "";
  try {
    // same-origin Access identity; includes IdP profile claims when configured
    const res = await fetch("/cdn-cgi/access/get-identity");
    if (res.ok) {
      const id = (await res.json()) as Record<string, unknown>;
      name = pick(id, "name") || pick(id.custom, "name") || pick(id.oidc_fields, "name");
      picture = pick(id, "picture") || pick(id.custom, "picture") || pick(id.oidc_fields, "picture");
    }
  } catch {
    // local dev: no Access in front
  }
  if (!name) {
    try {
      name = (await api.get<{ name: string }>("/api/me")).name ?? "";
    } catch {
      // not signed in / invite gate — keep the gear
    }
  }
  if (!name && !picture) return;

  const fallback = h(
    "span",
    { class: "avatar avatar-fallback", "aria-hidden": "true" },
    (name[0] ?? "?").toUpperCase()
  );
  const avatar = picture
    ? h("img", {
        class: "avatar",
        src: picture,
        alt: "",
        referrerpolicy: "no-referrer",
        onerror: () => avatar.replaceWith(fallback),
      })
    : fallback;
  chip.replaceChildren(avatar);
  if (name) chip.append(h("span", { class: "user-name" }, name));
}

void loadUserChip();

const now = new Date();
document.getElementById("topbar-date")!.textContent = `${now.getFullYear()}/${
  now.getMonth() + 1
}/${now.getDate()}（${"日一二三四五六"[now.getDay()]}）`;

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

window.addEventListener("hashchange", render);
render();
