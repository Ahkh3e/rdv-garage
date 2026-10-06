import type { Module } from "@rdv/core";
import { accounts } from "@rdv/accounts";
import { crews } from "@rdv/crews";
import { leaderboard } from "@rdv/leaderboard";
import { liveLocation } from "@rdv/live-location";
import { map } from "@rdv/map";
import { referral } from "@rdv/referral";

// The one central list. Add a module by adding its entry; remove one by deleting its entry.
export const modules: Module[] = [accounts, referral, crews, map, liveLocation, leaderboard];
