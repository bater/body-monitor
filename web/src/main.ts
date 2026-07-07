import "./style.css";
import { renderDashboard } from "./pages/dashboard";
import { renderFood } from "./pages/food";
import { renderWorkout } from "./pages/workout";
import { renderExercises } from "./pages/exercises";
import { renderInBody } from "./pages/inbody";
import { renderSettings } from "./pages/settings";

const routes: Record<string, (page: HTMLElement) => void> = {
  "": renderDashboard,
  food: renderFood,
  workout: renderWorkout,
  exercises: renderExercises,
  inbody: renderInBody,
  settings: renderSettings,
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
  const tabRoute = route === "exercises" ? "workout" : route in routes ? route : "";
  document.querySelectorAll<HTMLAnchorElement>("#tabbar a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === tabRoute);
  });
}

const now = new Date();
document.getElementById("topbar-date")!.textContent = `${now.getFullYear()}/${
  now.getMonth() + 1
}/${now.getDate()}（${"日一二三四五六"[now.getDay()]}）`;

window.addEventListener("hashchange", render);
render();
