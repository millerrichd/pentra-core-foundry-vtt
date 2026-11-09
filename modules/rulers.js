/**
 * Range bands on the map. The measuring ruler and the token drag ruler both label the distance with its Pentra
 * range band (Melee, Very Close, Close, Far, Very Far, Out of Range) and color the path by band.
 * Dragging a token also shows what the move costs: up to Close is a normal move, up to Far is a run (−2 to all
 * actions that round), and beyond Far is too far for one round. A Leg Wound drops each limit one band.
 */
import { bandForDistance, moveLimits } from "./rules.js";
import { PENTRA } from "./config.js";
import { actorUnderwater } from "./underwater.js";

const SYSTEM = "pentra-core-foundry-vtt";
const LABEL_TEMPLATE = `systems/${SYSTEM}/templates/hud/waypoint-label.hbs`;
const loc = key => game.i18n.localize(key);

/** Path colors by range band, nearest to farthest. */
export const BAND_COLORS = {
  melee: 0xd64545,
  veryClose: 0xe8873a,
  close: 0xe3c43a,
  far: 0x54b062,
  veryFar: 0x4a8ad6,
  outOfRange: 0x8a8a8a
};

/** Movement in one round: Close is a normal move, Far is a run (−2), anything more is too far. */
const MOVE = {
  walk: { color: 0x54b062, label: "PENTRA.Move.Walk" },
  run: { color: 0xe8a13a, label: "PENTRA.Move.Run" },
  tooFar: { color: 0xd64545, label: "PENTRA.Move.TooFar" }
};
/**
 * Movement limits in yards: a normal move reaches Close and a run reaches Far. A Leg Wound costs one range band,
 * so the move reaches Very Close and the run reaches Close.
 */
const limitsFor = actor => moveLimits(actor?.statuses?.has("legWound"), actorUnderwater(actor));
const moveKind = (yards, limits = moveLimits(false)) => (yards <= limits.walk ? "walk" : yards <= limits.run ? "run" : "tooFar");

const enabled = () => game.settings.get(SYSTEM, "rangeBandRuler");
const bandOf = yards => {
  const key = bandForDistance(yards);
  return { key, label: loc(PENTRA.rangeBands[key]) };
};

export function registerRulers() {
  const BaseRuler = CONFIG.Canvas.rulerClass;
  const BaseTokenRuler = CONFIG.Token.rulerClass;

  /** The measuring tool: label each leg with the band of the total distance and color the line by band. */
  class PentraRuler extends BaseRuler {
    static WAYPOINT_LABEL_TEMPLATE = LABEL_TEMPLATE;

    _getWaypointLabelContext(waypoint, state) {
      const context = super._getWaypointLabelContext(waypoint, state);
      if (context && enabled()) context.pentraBand = bandOf(waypoint.measurement.distance);
      return context;
    }

    _getSegmentStyle(waypoint) {
      const style = super._getSegmentStyle(waypoint);
      if (!enabled() || !style.width) return style;
      return { ...style, color: BAND_COLORS[bandForDistance(waypoint.measurement.distance)] };
    }
  }

  /** Dragging a token: label the band and the move type, and color each square by how far into the move it is. */
  class PentraTokenRuler extends BaseTokenRuler {
    static WAYPOINT_LABEL_TEMPLATE = LABEL_TEMPLATE;

    _getWaypointLabelContext(waypoint, state) {
      const context = super._getWaypointLabelContext(waypoint, state);
      if (context && enabled()) {
        const yards = waypoint.measurement.distance;
        context.pentraBand = bandOf(yards);
        const kind = moveKind(yards, limitsFor(this.token.actor));
        const hobbled = this.token.actor?.statuses?.has("legWound");
        context.pentraMove = { key: kind, label: loc(MOVE[kind].label) + (hobbled ? ` (${loc("PENTRA.Status.legWound")})` : "") };
      }
      return context;
    }

    _getGridHighlightStyle(waypoint, offset) {
      const style = super._getGridHighlightStyle(waypoint, offset);
      if (!enabled() || !(style.alpha > 0)) return style;
      return { ...style, color: MOVE[moveKind(waypoint.measurement.distance, limitsFor(this.token.actor))].color };
    }

    _getSegmentStyle(waypoint) {
      const style = super._getSegmentStyle(waypoint);
      if (!enabled() || !style.width) return style;
      return { ...style, color: MOVE[moveKind(waypoint.measurement.distance, limitsFor(this.token.actor))].color };
    }
  }

  CONFIG.Canvas.rulerClass = PentraRuler;
  CONFIG.Token.rulerClass = PentraTokenRuler;
}

