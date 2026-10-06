import type { Module } from "@rdv/core";
import { createController } from "./controller";
import { GoLiveControl, setController } from "./GoLive";
import { ChannelHub } from "./hub";
import { startReceiver } from "./receiver";

// Importing task registers the background location task at load time.
import "./task";

export { LiveEngine } from "./engine";

export const liveLocation: Module = {
  id: "live-location",
  register(shell) {
    shell.addFlag("live-location", true);
    if (!shell.isEnabled("live-location")) return;
    const hub = new ChannelHub(shell.backend);
    const controller = createController(shell, hub);
    setController(controller);
    startReceiver(shell, hub, () => controller.liveCrews());
    shell.addSlot("map.overlay", GoLiveControl, 10);
  },
};
