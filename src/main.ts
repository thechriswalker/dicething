import { mount } from "svelte";
import App from "./App.svelte";
import { createScene } from "./lib/scene";

// create the scene for the background viewport
// lets see about managing this on a "per-dice" basis
// const viewport = document.getElementById("viewport");
// const scene = createScene(viewport!);

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
