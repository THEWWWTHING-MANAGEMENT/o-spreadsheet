import { args } from "./arguments";
import { FunctionMap } from "./index";

export const functions: FunctionMap = {
  WAIT: {
    description: "Wait",
    args: args`ms (number) wait time in milliseconds`,
    returns: ["ANY"],
    async: true,
    compute: function(...args) {
      return new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve(args[0]);
        }, 2000);
      });
    }
  },
  AND: {
    description: "Returns true if all the arguments are true, false otherwise.",
    args: args`logicalPart (boolean,repeating) logical part`,
    returns: ["BOOLEAN"],
    compute: function(...args) {
      return args.reduce((a, b) => a && b, true);
    }
  },
  OR: {
    description: "Returns true if at least one of the arguments are true, false otherwise.",
    args: args`logicalPart (boolean,repeating) logical part`,
    returns: ["BOOLEAN"],
    compute: function(...args) {
      return args.reduce((a, b) => a || b, false);
    }
  },
  XOR: {
    description:
      "Returns true if an odd number of the provided arguments are true, false otherwise.",
    args: args`logicalPart (boolean,repeating) logical part`,
    returns: ["BOOLEAN"],
    compute: function(...args) {
      return args.filter(a => a).length % 2 !== 0;
    }
  },
  NOT: {
    description: "Returns true if the argument is false, false otherwise.",
    args: args`XXX (boolean) logical part`,
    returns: ["BOOLEAN"],
    compute: function(value) {
      return !value;
    }
  },
  IF: {
    description: "Returns the second argument if the first one is true, the third otherwise.",
    args: args`
      condition (boolean) logical part
      valueTrue (any) the value of the cell if the condition is true
      valueFalse (any) the value of the cell if the condition is false
    `,
    returns: ["ANY"],
    compute: function(condition, valueTrue, valueFalse) {
      return condition ? valueTrue : valueFalse;
    }
  }
};