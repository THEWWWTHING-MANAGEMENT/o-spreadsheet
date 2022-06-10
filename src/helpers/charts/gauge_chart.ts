import { transformZone } from "../../collaborative/ot/ot_helpers";
import {
  BACKGROUND_CHART_COLOR,
  DEFAULT_GAUGE_LOWER_COLOR,
  DEFAULT_GAUGE_MIDDLE_COLOR,
  DEFAULT_GAUGE_UPPER_COLOR,
} from "../../constants";
import { BasePlugin } from "../../plugins/base_plugin";
import { chartRegistry } from "../../registries/chart_types";
import {
  AddColumnsRowsCommand,
  ApplyRangeChange,
  CellValueType,
  CommandResult,
  CoreGetters,
  Getters,
  Range,
  RemoveColumnsRowsCommand,
  UID,
  Validation,
  Zone,
} from "../../types";
import { ChartCreationContext } from "../../types/chart/chart";
import {
  GaugeChartDefinition,
  GaugeChartRuntime,
  SectionRule,
} from "../../types/chart/gauge_chart";
import { Validator } from "../../types/validator";
import { clip } from "../index";
import { createRange } from "../range";
import { rangeReference } from "../references";
import { toZone, zoneToXc } from "../zones";
import { AbstractChart } from "./abstract_chart";
import { adaptChartRange, chartFontColor, copyLabelRangeWithNewSheetId } from "./chart_common";
import { getDefaultChartJsRuntime } from "./chart_ui_common";

chartRegistry.add("gauge", {
  match: (type) => type === "gauge",
  createChart: (id, definition, sheetId, getters) =>
    new GaugeChart(id, definition as GaugeChartDefinition, sheetId, getters),
  getChartRuntime: createGaugeChartRuntime,
  validateChartDefinition: (validator, definition) =>
    GaugeChart.validateChartDefinition(validator, definition as GaugeChartDefinition),
  transformDefinition: (
    definition: GaugeChartDefinition,
    executed: AddColumnsRowsCommand | RemoveColumnsRowsCommand
  ) => GaugeChart.transformDefinition(definition, executed),
  getChartDefinitionFromContextCreation: (context: ChartCreationContext) =>
    GaugeChart.getDefinitionFromContextCreation(context),
  name: "Gauge",
});

type RangeLimitsValidation = (rangeLimit: string, rangeLimitName: string) => CommandResult;
type InflectionPointValueValidation = (
  inflectionPointValue: string,
  inflectionPointName: string
) => CommandResult;

function checkEmptyDataRange(definition: GaugeChartDefinition): CommandResult {
  return !definition.dataRange ? CommandResult.EmptyGaugeDataRange : CommandResult.Success;
}

function isDataRangeValid(definition: GaugeChartDefinition): CommandResult {
  return definition.dataRange && !rangeReference.test(definition.dataRange)
    ? CommandResult.InvalidGaugeDataRange
    : CommandResult.Success;
}

function checkRangeLimits(
  check: RangeLimitsValidation,
  batchValidations: BasePlugin["batchValidations"]
): Validation<GaugeChartDefinition> {
  return batchValidations(
    (definition) => {
      if (definition.sectionRule) {
        return check(definition.sectionRule.rangeMin, "rangeMin");
      }
      return CommandResult.Success;
    },
    (definition) => {
      if (definition.sectionRule) {
        return check(definition.sectionRule.rangeMax, "rangeMax");
      }
      return CommandResult.Success;
    }
  );
}

function checkInflectionPointsValue(
  check: InflectionPointValueValidation,
  batchValidations: BasePlugin["batchValidations"]
): Validation<GaugeChartDefinition> {
  return batchValidations(
    (definition) => {
      if (definition.sectionRule) {
        return check(
          definition.sectionRule.lowerInflectionPoint.value,
          "lowerInflectionPointValue"
        );
      }
      return CommandResult.Success;
    },
    (definition) => {
      if (definition.sectionRule) {
        return check(
          definition.sectionRule.upperInflectionPoint.value,
          "upperInflectionPointValue"
        );
      }
      return CommandResult.Success;
    }
  );
}

function checkRangeMinBiggerThanRangeMax(definition: GaugeChartDefinition): CommandResult {
  if (definition.sectionRule) {
    if (Number(definition.sectionRule.rangeMin) >= Number(definition.sectionRule.rangeMax)) {
      return CommandResult.GaugeRangeMinBiggerThanRangeMax;
    }
  }
  return CommandResult.Success;
}

function checkEmpty(value: string, valueName: string) {
  if (value === "") {
    switch (valueName) {
      case "rangeMin":
        return CommandResult.EmptyGaugeRangeMin;
      case "rangeMax":
        return CommandResult.EmptyGaugeRangeMax;
    }
  }
  return CommandResult.Success;
}

function checkNaN(value: string, valueName: string) {
  if (isNaN(value as any)) {
    switch (valueName) {
      case "rangeMin":
        return CommandResult.GaugeRangeMinNaN;
      case "rangeMax":
        return CommandResult.GaugeRangeMaxNaN;
      case "lowerInflectionPointValue":
        return CommandResult.GaugeLowerInflectionPointNaN;
      case "upperInflectionPointValue":
        return CommandResult.GaugeUpperInflectionPointNaN;
    }
  }
  return CommandResult.Success;
}

export class GaugeChart extends AbstractChart {
  readonly dataRange?: Range;
  readonly sectionRule: SectionRule;
  readonly background: string;
  readonly type = "gauge";

  constructor(id: UID, definition: GaugeChartDefinition, sheetId: UID, getters: CoreGetters) {
    super(id, definition, sheetId, getters);
    this.dataRange = createRange(this.getters, this.sheetId, definition.dataRange);
    this.sectionRule = definition.sectionRule;
    this.background = definition.background;
  }

  static validateChartDefinition(
    validator: Validator,
    definition: GaugeChartDefinition
  ): CommandResult | CommandResult[] {
    return validator.checkValidations(
      definition,
      validator.chainValidations(checkEmptyDataRange, isDataRangeValid),
      validator.chainValidations(
        checkRangeLimits(checkEmpty, validator.batchValidations),
        checkRangeLimits(checkNaN, validator.batchValidations),
        checkRangeMinBiggerThanRangeMax
      ),
      validator.chainValidations(checkInflectionPointsValue(checkNaN, validator.batchValidations))
    );
  }

  static transformDefinition(
    definition: GaugeChartDefinition,
    executed: AddColumnsRowsCommand | RemoveColumnsRowsCommand
  ): GaugeChartDefinition {
    let dataRangeZone: Zone | undefined;
    if (definition.dataRange) {
      dataRangeZone = transformZone(toZone(definition.dataRange), executed);
    }

    return {
      ...definition,
      dataRange: dataRangeZone ? zoneToXc(dataRangeZone) : undefined,
    };
  }

  static getDefinitionFromContextCreation(context: ChartCreationContext): GaugeChartDefinition {
    return {
      background: context.background || BACKGROUND_CHART_COLOR,
      title: context.title || "",
      type: "gauge",
      dataRange: context.range,
      sectionRule: {
        colors: {
          lowerColor: DEFAULT_GAUGE_LOWER_COLOR,
          middleColor: DEFAULT_GAUGE_MIDDLE_COLOR,
          upperColor: DEFAULT_GAUGE_UPPER_COLOR,
        },
        rangeMin: "0",
        rangeMax: "100",
        lowerInflectionPoint: {
          type: "percentage",
          value: "15",
        },
        upperInflectionPoint: {
          type: "percentage",
          value: "40",
        },
      },
    };
  }

  copyForSheetId(sheetId: string): GaugeChart {
    const dataRange = copyLabelRangeWithNewSheetId(this.sheetId, sheetId, this.dataRange);
    const definition = this.getDefinitionWithSpecificRanges(dataRange);
    return new GaugeChart(this.id, definition, sheetId, this.getters);
  }

  getSheetIdsUsedInChartRanges(): UID[] {
    return this.dataRange ? [this.dataRange.sheetId] : [];
  }

  getDefinition(): GaugeChartDefinition {
    return this.getDefinitionWithSpecificRanges(this.dataRange);
  }

  private getDefinitionWithSpecificRanges(dataRange: Range | undefined): GaugeChartDefinition {
    return {
      background: this.background,
      sectionRule: this.sectionRule,
      title: this.title,
      type: "gauge",
      dataRange: dataRange ? this.getters.getRangeString(dataRange, this.sheetId) : undefined,
    };
  }

  getDefinitionForExcel() {
    // This kind of graph is not exportable in Excel
    return undefined;
  }

  getContextCreation(): ChartCreationContext {
    return {
      background: this.background,
      title: this.title,
      range: this.dataRange ? this.getters.getRangeString(this.dataRange, this.sheetId) : undefined,
    };
  }

  updateRanges(applyChange: ApplyRangeChange): GaugeChart {
    const range = adaptChartRange(this.dataRange, applyChange);
    if (this.dataRange === range) {
      return this;
    }
    const definition = this.getDefinitionWithSpecificRanges(range);
    return new GaugeChart(this.id, definition, this.sheetId, this.getters);
  }
}

function getGaugeConfiguration(chart: GaugeChart): GaugeChartRuntime {
  const fontColor = chartFontColor(chart.background);
  const config: GaugeChartRuntime = getDefaultChartJsRuntime(
    chart,
    [],
    fontColor
  ) as GaugeChartRuntime;
  config.options!.hover = undefined;
  config.options!.events = [];
  config.options!.layout = {
    padding: { left: 30, right: 30, top: chart.title ? 10 : 25, bottom: 25 },
  };
  config.options!.needle = {
    radiusPercentage: 2,
    widthPercentage: 3.2,
    lengthPercentage: 80,
    color: "#000000",
  };
  config.options!.valueLabel = {
    display: false,
    formatter: null,
    color: "#FFFFFF",
    backgroundColor: "#000000",
    fontSize: 30,
    borderRadius: 5,
    padding: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    bottomMarginPercentage: 5,
  };
  return config;
}

function createGaugeChartRuntime(chart: GaugeChart, getters: Getters): GaugeChartRuntime {
  const runtime = getGaugeConfiguration(chart);
  const colors = chart.sectionRule.colors;

  const lowerPoint = chart.sectionRule.lowerInflectionPoint;
  const upperPoint = chart.sectionRule.upperInflectionPoint;
  const lowerPointValue = Number(lowerPoint.value);
  const upperPointValue = Number(upperPoint.value);
  const minNeedleValue = Number(chart.sectionRule.rangeMin);
  const maxNeedleValue = Number(chart.sectionRule.rangeMax);
  const needleCoverage = maxNeedleValue - minNeedleValue;

  const needleInflectionPoint: { value: number; color: string }[] = [];

  if (lowerPoint.value !== "") {
    const lowerPointNeedleValue =
      lowerPoint.type === "number"
        ? lowerPointValue
        : minNeedleValue + (needleCoverage * lowerPointValue) / 100;
    needleInflectionPoint.push({
      value: clip(lowerPointNeedleValue, minNeedleValue, maxNeedleValue),
      color: colors.lowerColor,
    });
  }

  if (upperPoint.value !== "") {
    const upperPointNeedleValue =
      upperPoint.type === "number"
        ? upperPointValue
        : minNeedleValue + (needleCoverage * upperPointValue) / 100;
    needleInflectionPoint.push({
      value: clip(upperPointNeedleValue, minNeedleValue, maxNeedleValue),
      color: colors.middleColor,
    });
  }

  const data: number[] = [];
  const backgroundColor: string[] = [];
  needleInflectionPoint
    .sort((a, b) => a.value - b.value)
    .map((point) => {
      data.push(point.value);
      backgroundColor.push(point.color);
    });
  // There's a bug in gauge lib when the last element in `data` is 0 (i.e. when the range maximum is 0).
  // The value wrongly fallbacks to 1 because 0 is falsy
  // See https://github.com/haiiaaa/chartjs-gauge/pull/33
  // https://github.com/haiiaaa/chartjs-gauge/blob/2ea50541d754d710cb30c2502fa690ac5dc27afd/src/controllers/controller.gauge.js#L52
  data.push(maxNeedleValue);
  backgroundColor.push(colors.upperColor);

  const dataRange = chart.dataRange;
  const deltaBeyondRangeLimit = needleCoverage / 30;
  let needleValue = minNeedleValue - deltaBeyondRangeLimit; // make needle value always at the minimum by default
  let cellFormatter: (() => string) | null = null;
  let displayValue = false;

  if (dataRange !== undefined) {
    const cell = getters.getCell(dataRange.sheetId, dataRange.zone.left, dataRange.zone.top);
    if (cell?.evaluated.type === CellValueType.number) {
      // in gauge graph "datasets.value" is used to calculate the angle of the
      // needle in the graph. To prevent the needle from making 360° turns, we
      // clip the value between a min and a max. This min and this max are slightly
      // smaller and slightly larger than minRange and maxRange to mark the fact
      // that the needle is out of the range limits
      needleValue = clip(
        cell?.evaluated.value,
        minNeedleValue - deltaBeyondRangeLimit,
        maxNeedleValue + deltaBeyondRangeLimit
      );
      cellFormatter = () => getters.getRangeFormattedValues(dataRange)[0];
      displayValue = true;
    }
  }

  runtime.options!.valueLabel!.display = displayValue;
  runtime.options!.valueLabel!.formatter = cellFormatter;
  runtime.data!.datasets!.push({
    data,
    minValue: Number(chart.sectionRule.rangeMin),
    value: needleValue,
    backgroundColor,
  });

  return runtime;
}