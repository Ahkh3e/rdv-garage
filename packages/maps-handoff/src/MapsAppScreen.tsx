import { Fragment } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Card, Divider, Row, Screen, Text, colors, useStore } from "@rdv/core";
import { APP_NAMES, appsFor } from "./apps";
import { effectiveApp } from "./prefs";
import { os, prefs } from "./native";

export function MapsAppScreen() {
  const current = effectiveApp(useStore(prefs.store));
  return (
    <Screen>
      <Card>
        {appsFor(os).map((app, index) => (
          <Fragment key={app}>
            {index > 0 ? <Divider /> : null}
            <Row
              testID={`maps-app-${app}`}
              title={APP_NAMES[app]}
              right={app === current ? <Ionicons name="checkmark" size={20} color={colors.accentBright} /> : undefined}
              onPress={() => prefs.set(app)}
            />
          </Fragment>
        ))}
      </Card>
      <Text variant="caption" style={{ color: colors.muted }}>
        Directions opens here. Only the place location is sent, never yours.
      </Text>
    </Screen>
  );
}
