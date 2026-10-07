import type { Module } from "@rdv/core";
import { createPlacesController, PICKER_ROUTE } from "./controller";
import { createGeocoder } from "./geocoder";
import { PlacePickerScreen } from "./PlacePickerScreen";
import { PlacesOverlay } from "./PlacesOverlay";
import { setController } from "./context";
import { recents } from "./native";

export { CATEGORIES, categoryOf, nearby, formatDistance, type CategoryId } from "./categories";
export { coarseBias } from "./bias";

export const places: Module = {
  id: "places",
  register(shell) {
    shell.addFlag("places", true);
    if (!shell.isEnabled("places")) return;
    const controller = createPlacesController(shell);
    setController(shell, controller);
    void recents.load();
    let lastUser: string | null = null;
    const followSession = () => {
      const session = shell.session.get();
      if (session.status === "signedOut") {
        lastUser = null;
        recents.clear();
      } else if (session.status === "signedIn") {
        if (lastUser && lastUser !== session.userId) recents.clear();
        lastUser = session.userId;
      }
    };
    followSession();
    shell.session.subscribe(followSession);
    shell.setGeocoder(createGeocoder((body) => shell.backend.invoke("search_places", body)));
    shell.setPlaceUi({ openCard: controller.openPlace, pick: controller.pickPlace });
    shell.pins.register({ id: "places", pins: controller.pins });
    shell.addRoute({ name: PICKER_ROUTE, component: PlacePickerScreen, title: "Choose a place", presentation: "modal" });
    shell.addSlot("map.overlay", PlacesOverlay, 10);
  },
};
