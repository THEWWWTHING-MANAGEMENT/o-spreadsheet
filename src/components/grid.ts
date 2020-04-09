import * as owl from "@odoo/owl";
import {
  BACKGROUND_GRAY_COLOR,
  DEFAULT_CELL_HEIGHT,
  HEADER_WIDTH,
  SCROLLBAR_WIDTH
} from "../constants";
import { isEqual, isInside } from "../helpers/index";
import { Model } from "../model";
import { UI, Viewport } from "../types/index";
import { Composer } from "./composer";
import { ContextMenu, ContextMenuType } from "./context_menu";
import { Overlay } from "./overlay";

/**
 * The Grid component is the main part of the spreadsheet UI. It is responsible
 * for displaying the actual grid, rendering it, managing events, ...
 *
 * The grid is rendered on a canvas. 3 sub components are (sometimes) displayed
 * on top of the canvas:
 * - a composer (to edit the cell content)
 * - a horizontal resizer (to resize columns)
 * - a vertical resizer (same, for rows)
 */

const { Component, useState } = owl;
const { xml, css } = owl.tags;
const { useRef } = owl.hooks;

// -----------------------------------------------------------------------------
// TEMPLATE
// -----------------------------------------------------------------------------
const TEMPLATE = xml/* xml */ `
  <div class="o-grid" t-on-click="focus" t-on-keydown="onKeydown">
    <t t-if="state.editionMode !== 'inactive'">
      <Composer model="model" t-ref="composer" t-on-composer-unmounted="focus" viewport="viewport"/>
    </t>
    <canvas t-ref="canvas"
      t-on-mousedown="onMouseDown"
      t-on-dblclick="onDoubleClick"
      tabindex="-1"
      t-on-contextmenu="onCanvasContextMenu"
      t-on-wheel="onMouseWheel" />

    <Overlay model="model" t-on-open-contextmenu="onOverlayContextMenu" viewport="viewport"/>
    <ContextMenu t-if="contextMenu.isOpen"
      model="model"
      type="contextMenu.type"
      position="contextMenu.position"
      t-on-close.stop="contextMenu.isOpen=false"/>
    <div class="o-scrollbar vertical" t-on-scroll="onScroll" t-ref="vscrollbar">
      <div t-attf-style="width:1px;height:{{gridSize[1]}}px"/>
    </div>
    <div class="o-scrollbar horizontal" t-on-scroll="onScroll" t-ref="hscrollbar">
      <div t-attf-style="height:1px;width:{{gridSize[0]}}px"/>
    </div>
  </div>`;

// -----------------------------------------------------------------------------
// STYLE
// -----------------------------------------------------------------------------
const CSS = css/* scss */ `
  .o-grid {
    position: relative;
    overflow: hidden;
    background-color: ${BACKGROUND_GRAY_COLOR};

    > canvas {
      border-top: 1px solid #aaa;
      border-bottom: 1px solid #aaa;

      &:focus {
        outline: none;
      }
    }

    .o-scrollbar {
      position: absolute;
      overflow: auto;
      &.vertical {
        right: 0;
        top: ${SCROLLBAR_WIDTH + 1}px;
        bottom: 15px;
        width: 15px;
      }
      &.horizontal {
        bottom: 0;
        height: 15px;
        right: ${SCROLLBAR_WIDTH + 1}px;
        left: ${HEADER_WIDTH}px;
      }
    }
  }
`;

// copy and paste are specific events that should not be managed by the keydown event,
// but they shouldn't be preventDefault and stopped (else copy and paste events will not trigger)
// and also should not result in typing the character C or V in the composer
const keyDownMappingIgnore: string[] = ["CTRL+C", "CTRL+V"];

// -----------------------------------------------------------------------------
// JS

// -----------------------------------------------------------------------------
export class Grid extends Component<any, any> {
  static template = TEMPLATE;
  static style = CSS;
  static components = { Composer, Overlay, ContextMenu };

  contextMenu = useState({ isOpen: false, position: null, type: "CELL" } as {
    isOpen: boolean;
    position: null | { x: number; y: number; width: number; height: number };
    type: ContextMenuType;
  });

  composer = useRef("composer");

  vScrollbar = useRef("vscrollbar");
  hScrollbar = useRef("hscrollbar");
  canvas = useRef("canvas");
  hasFocus = false;
  model: Model = this.props.model;
  state: UI = this.model.state;
  gridSize: [number, number] = this.model.getters.getGridSize();
  currentPosition = this.model.getters.getPosition();

  clickedCol = 0;
  clickedRow = 0;
  viewport: Viewport = {
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0
  };

  // this map will handle most of the actions that should happen on key down. The arrow keys are managed in the key
  // down itself
  keyDownMapping: { [key: string]: Function } = {
    ENTER: () => this.model.dispatch({ type: "START_EDITION" }),
    TAB: () => this.model.dispatch({ type: "MOVE_POSITION", deltaX: 1, deltaY: 0 }),
    "SHIFT+TAB": () => this.model.dispatch({ type: "MOVE_POSITION", deltaX: -1, deltaY: 0 }),
    F2: () => this.model.dispatch({ type: "START_EDITION" }),
    DELETE: () => {
      this.model.dispatch({
        type: "DELETE_CONTENT",
        sheet: this.state.activeSheet,
        target: this.model.getters.getSelectedZones()
      });
    },
    "CTRL+A": () => this.model.dispatch({ type: "SELECT_ALL" }),
    "CTRL+S": () => {
      this.trigger("save-content", {
        data: this.model.exportData()
      });
    },
    "CTRL+Z": () => this.model.dispatch({ type: "UNDO" }),
    "CTRL+Y": () => this.model.dispatch({ type: "REDO" })
  };

  private processCopyFormat() {
    if (this.model.getters.isPaintingFormat()) {
      this.model.dispatch({
        type: "PASTE",
        target: this.model.getters.getSelectedZones()
      });
    }
  }

  mounted() {
    this.focus();
    this.drawGrid();
  }

  willPatch() {
    this.hasFocus = this.el!.contains(document.activeElement);
  }

  async willUpdateProps() {
    this.gridSize = this.model.getters.getGridSize();
    this.state = this.model.state;
  }

  patched() {
    this.drawGrid();
  }

  focus() {
    if (this.state.editionMode !== "selecting") {
      this.canvas.el!.focus();
    }
  }

  onScroll() {
    this.viewport.offsetX = this.hScrollbar.el!.scrollLeft;
    this.viewport.offsetY = this.vScrollbar.el!.scrollTop;
    const viewport = this.model.getters.getAdjustedViewport(this.viewport, "zone");
    if (!isEqual(viewport, this.viewport)) {
      this.viewport = viewport;
      this.render();
    }
  }

  checkPosition(): boolean {
    const [col, row] = this.model.getters.getPosition();
    const [curCol, curRow] = this.currentPosition;
    const didChange = col !== curCol || row !== curRow;
    if (didChange) {
      this.currentPosition = [col, row];
    }
    return didChange;
  }

  drawGrid() {
    // update viewport dimensions
    this.viewport.width = this.el!.clientWidth - SCROLLBAR_WIDTH;
    this.viewport.height = this.el!.clientHeight - SCROLLBAR_WIDTH;
    this.viewport.offsetX = this.hScrollbar.el!.scrollLeft;
    this.viewport.offsetY = this.vScrollbar.el!.scrollTop;

    // check for position changes
    if (this.checkPosition()) {
      this.viewport = this.model.getters.getAdjustedViewport(this.viewport, "position");
      this.hScrollbar.el!.scrollLeft = this.viewport.offsetX;
      this.vScrollbar.el!.scrollTop = this.viewport.offsetY;
    } else {
      this.viewport = this.model.getters.getAdjustedViewport(this.viewport, "zone");
    }

    // drawing grid on canvas
    const canvas = this.canvas.el as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const thinLineWidth = 0.4 * dpr;
    const renderingContext = { ctx, viewport: this.viewport, dpr, thinLineWidth };
    const { width, height } = this.viewport;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.setAttribute("style", `width:${width}px;height:${height}px;`);
    ctx.translate(-0.5, -0.5);
    ctx.scale(dpr, dpr);
    this.model.drawGrid(renderingContext);
  }

  onMouseWheel(ev: WheelEvent) {
    function normalize(val: number): number {
      return val * (ev.deltaMode === 0 ? 1 : DEFAULT_CELL_HEIGHT);
    }
    const vScrollbar = this.vScrollbar.el!;
    vScrollbar.scrollTop = vScrollbar.scrollTop + normalize(ev.deltaY);
    const hScrollbar = this.hScrollbar.el!;
    hScrollbar.scrollLeft = hScrollbar.scrollLeft + normalize(ev.deltaX);
  }

  // ---------------------------------------------------------------------------
  // Zone selection with mouse
  // ---------------------------------------------------------------------------

  onMouseDown(ev: MouseEvent) {
    if (ev.button > 0) {
      // not main button, probably a context menu
      return;
    }
    const col = this.model.getters.getCol(ev.offsetX, this.viewport.left);
    const row = this.model.getters.getRow(ev.offsetY, this.viewport.top);
    if (col < 0 || row < 0) {
      return;
    }
    this.clickedCol = col;
    this.clickedRow = row;

    if (ev.shiftKey) {
      this.model.dispatch({ type: "ALTER_SELECTION", cell: [col, row] });
    } else {
      this.model.dispatch({ type: "SELECT_CELL", col, row, createNewRange: ev.ctrlKey });
      this.checkPosition();
    }
    let prevCol = col;
    let prevRow = row;
    const onMouseMove = ev => {
      const col = this.model.getters.getCol(ev.offsetX, this.viewport.left);
      const row = this.model.getters.getRow(ev.offsetY, this.viewport.top);
      if (col < 0 || row < 0) {
        return;
      }
      if (col !== prevCol || row !== prevRow) {
        prevCol = col;
        prevRow = row;
        this.model.dispatch({ type: "ALTER_SELECTION", cell: [col, row] });
      }
    };
    const onMouseUp = ev => {
      if (this.model.state.editionMode === "selecting") {
        if (this.composer.comp) {
          (this.composer.comp as Composer).addTextFromSelection();
        }
      }
      this.canvas.el!.removeEventListener("mousemove", onMouseMove);
      if (this.model.getters.isPaintingFormat()) {
        this.model.dispatch({
          type: "PASTE",
          target: this.model.getters.getSelectedZones()
        });
      }
    };

    this.canvas.el!.addEventListener("mousemove", onMouseMove);
    document.body.addEventListener("mouseup", onMouseUp, { once: true });
  }

  onDoubleClick(ev) {
    const col = this.model.getters.getCol(ev.offsetX, this.viewport.left);
    const row = this.model.getters.getRow(ev.offsetY, this.viewport.top);
    if (this.clickedCol === col && this.clickedRow === row) {
      this.model.dispatch({ type: "START_EDITION" });
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard interactions
  // ---------------------------------------------------------------------------

  processTabKey(ev: KeyboardEvent) {
    ev.preventDefault();
    const deltaX = ev.shiftKey ? -1 : 1;
    this.model.dispatch({ type: "MOVE_POSITION", deltaX, deltaY: 0 });
    return;
  }

  processArrows(ev: KeyboardEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const deltaMap = {
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1]
    };
    const delta = deltaMap[ev.key];
    if (ev.shiftKey) {
      this.model.dispatch({ type: "ALTER_SELECTION", delta });
    } else {
      this.model.dispatch({ type: "MOVE_POSITION", deltaX: delta[0], deltaY: delta[1] });
    }

    if (this.model.state.editionMode === "selecting" && this.composer.comp) {
      (this.composer.comp as Composer).addTextFromSelection();
    } else {
      this.processCopyFormat();
    }
  }

  onKeydown(ev: KeyboardEvent) {
    if (ev.key.startsWith("Arrow")) {
      this.processArrows(ev);
      return;
    }

    let keyDownString = "";
    if (ev.ctrlKey) keyDownString += "CTRL+";
    if (ev.metaKey) keyDownString += "CTRL+";
    if (ev.altKey) keyDownString += "ALT+";
    if (ev.shiftKey) keyDownString += "SHIFT+";
    keyDownString += ev.key.toUpperCase();

    let handler = this.keyDownMapping[keyDownString];
    if (handler) {
      ev.preventDefault();
      ev.stopPropagation();
      handler();
      return;
    }
    if (!keyDownMappingIgnore.includes(keyDownString)) {
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        // if the user types a character on the grid, it means he wants to start composing the selected cell with that
        // character
        ev.preventDefault();
        ev.stopPropagation();
        this.model.dispatch({ type: "START_EDITION", text: ev.key });
      }
    }
  }

  onCanvasContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    const col = this.model.getters.getCol(ev.offsetX, this.viewport.left);
    const row = this.model.getters.getRow(ev.offsetY, this.viewport.top);
    if (col < 0 || row < 0) {
      return;
    }
    const zones = this.model.getters.getSelectedZones();
    const lastZone = zones[zones.length - 1];
    let type: ContextMenuType = "CELL";
    if (!isInside(col, row, lastZone)) {
      this.model.dispatch({ type: "SELECT_CELL", col, row });
    } else {
      if (this.model.getters.getActiveCols().has(col)) {
        type = "COLUMN";
      } else if (this.model.getters.getActiveRows().has(row)) {
        type = "ROW";
      }
    }
    this.toggleContextMenu(type, ev.offsetX, ev.offsetY);
  }

  onOverlayContextMenu(ev: CustomEvent) {
    const type = ev.detail.type as ContextMenuType;
    const x = ev.detail.x;
    const y = ev.detail.y;
    this.toggleContextMenu(type, x, y);
  }

  toggleContextMenu(type: ContextMenuType, x: number, y: number) {
    this.contextMenu.isOpen = true;
    this.contextMenu.position = {
      x,
      y,
      width: this.el!.clientWidth,
      height: this.el!.clientHeight
    };
    this.contextMenu.type = type;
  }
}