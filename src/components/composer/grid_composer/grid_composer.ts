import { Component, onMounted, useRef, useState } from "@odoo/owl";
import {
  ComponentsImportance,
  DEFAULT_CELL_HEIGHT,
  SELECTION_BORDER_COLOR,
} from "../../../constants";
import { fontSizeMap } from "../../../fonts";
import { positionToZone } from "../../../helpers";
import { ComposerSelection } from "../../../plugins/ui_stateful/edition";
import { DOMDimension, Rect, Ref, SpreadsheetChildEnv, Zone } from "../../../types/index";
import { getTextDecoration } from "../../helpers";
import { css } from "../../helpers/css";
import { Composer } from "../composer/composer";

const SCROLLBAR_WIDTH = 14;
const SCROLLBAR_HIGHT = 15;

const COMPOSER_BORDER_WIDTH = 3 * 0.4 * window.devicePixelRatio || 1;
css/* scss */ `
  div.o-grid-composer {
    z-index: ${ComponentsImportance.Composer};
    box-sizing: border-box;
    position: absolute;
    border: ${COMPOSER_BORDER_WIDTH}px solid ${SELECTION_BORDER_COLOR};
  }
`;

interface ComposerState {
  rect?: Rect;
  delimitation?: DOMDimension;
}

interface Props {
  focus: "inactive" | "cellFocus" | "contentFocus";
  onComposerUnmounted: () => void;
  onComposerContentFocused: (selection: ComposerSelection) => void;
}

/**
 * This component is a composer which positions itself on the grid at the anchor cell.
 * It also applies the style of the cell to the composer input.
 */
export class GridComposer extends Component<Props, SpreadsheetChildEnv> {
  static template = "o-spreadsheet-GridComposer";
  static components = { Composer };

  private gridComposerRef!: Ref<HTMLElement>;

  private zone!: Zone;
  private rect!: Rect;

  private composerState!: ComposerState;

  setup() {
    this.gridComposerRef = useRef("gridComposer");
    this.composerState = useState({
      rect: undefined,
      delimitation: undefined,
    });
    const { sheetId, col, row } = this.env.model.getters.getActivePosition();
    this.zone = this.env.model.getters.expandZone(sheetId, positionToZone({ col, row }));
    this.rect = this.env.model.getters.getVisibleRect(this.zone);
    onMounted(() => {
      const el = this.gridComposerRef.el!;

      //TODO Should be more correct to have a props that give the parent's clientHeight and clientWidth
      const maxHeight = el.parentElement!.clientHeight - this.rect.y - SCROLLBAR_HIGHT;
      el.style.maxHeight = (maxHeight + "px") as string;

      const maxWidth = el.parentElement!.clientWidth - this.rect.x - SCROLLBAR_WIDTH;
      el.style.maxWidth = (maxWidth + "px") as string;

      this.composerState.rect = {
        x: this.rect.x,
        y: this.rect.y,
        width: el!.clientWidth,
        height: el!.clientHeight,
      };
      this.composerState.delimitation = {
        width: el!.parentElement!.clientWidth,
        height: el!.parentElement!.clientHeight,
      };
    });
  }

  get containerStyle(): string {
    const isFormula = this.env.model.getters.getCurrentContent().startsWith("=");
    const cell = this.env.model.getters.getActiveCell();
    const position = this.env.model.getters.getActivePosition();
    const style = this.env.model.getters.getCellComputedStyle(position);

    // position style
    const { x: left, y: top, width, height } = this.rect;

    // color style
    const background = (!isFormula && style.fillColor) || "#ffffff";
    const color = (!isFormula && style.textColor) || "#000000";

    // font style
    const fontSize = (!isFormula && style.fontSize) || 10;
    const fontWeight = !isFormula && style.bold ? "bold" : 500;
    const fontStyle = !isFormula && style.italic ? "italic" : "normal";
    const textDecoration = !isFormula ? getTextDecoration(style) : "none";

    // align style
    let textAlign = "left";

    if (!isFormula) {
      textAlign = style.align || cell.defaultAlign;
    }

    return `
      left: ${left - 1}px;
      top: ${top}px;
      min-width: ${width + 2}px;
      min-height: ${height + 1}px;

      background: ${background};
      color: ${color};

      font-size: ${fontSizeMap[fontSize]}px;
      font-weight: ${fontWeight};
      font-style: ${fontStyle};
      text-decoration: ${textDecoration};

      text-align: ${textAlign};
    `;
  }

  get composerStyle(): string {
    return `
      line-height: ${DEFAULT_CELL_HEIGHT}px;
      max-height: inherit;
      overflow: hidden;
    `;
  }
}

GridComposer.props = {
  focus: { validate: (value: string) => ["inactive", "cellFocus", "contentFocus"].includes(value) },
  onComposerUnmounted: Function,
  onComposerContentFocused: Function,
};
