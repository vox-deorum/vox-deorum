declare module 'ini-api' {
  export interface IniStringifyOptions {
    blankLineBeforeSection?: boolean;
    removeBlankLines?: boolean;
    removeCommentLines?: boolean;
  }

  export class IniLine {
    constructor(text: string);
    key?: string;
    value: unknown;
    comment: string;
    text: string;
    lineType: number;
  }

  export class IniSection {
    constructor(text?: string);
    lines: IniLine[];
    name?: string;
    addLine(text: string): IniLine;
    addLines(lines: string[]): IniLine[];
    getLine(key: string): IniLine | undefined;
    deleteLine(key: string): void;
    clear(): void;
    getValue(key: string): unknown;
    setValue(key: string, value: unknown): IniLine;
    getArray(key: string): unknown[];
    setArray(key: string, values: unknown[]): IniLine[];
  }

  export class Ini {
    static merge(...inis: Ini[]): Ini;
    constructor(text?: string, lineBreak?: string);
    lineBreak: string;
    globals: IniSection;
    sections: IniSection[];
    getSection(name: string): IniSection | undefined;
    addSection(name: string): IniSection;
    deleteSection(name: string): void;
    clear(): void;
    stringify(options?: IniStringifyOptions): string;
  }

  const iniApi: {
    Ini: typeof Ini;
    IniLine: typeof IniLine;
    IniSection: typeof IniSection;
    lineTypes: Record<string, number>;
  };

  export const lineTypes: Record<string, number>;
  export default iniApi;
}

declare module 'ini-api/index.js' {
  export * from 'ini-api';
  import iniApi from 'ini-api';
  export default iniApi;
}
