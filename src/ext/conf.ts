// Copyright (C) 2016  Patrick Maué
//
// This file is part of vscode-journal.
//
// vscode-journal is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// vscode-journal is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with vscode-journal.  If not, see <http://www.gnu.org/licenses/>.
//
'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as Path from 'path';
import * as Q from 'q';
import { isNullOrUndefined, isNull, isUndefined } from 'util';
import * as moment from 'moment';
import { Script } from 'vm';
import { Util } from '..';
import { isNotNullOrUndefined } from '../util';

export const SCOPE_DEFAULT = "default";



export enum JournalPageType {
    NOTE,
    ENTRY,
    ATTACHEMENT
}

export interface ScopedTemplate {
    name?: string
    scope?: string;
    template: string;
    value?: string;
}



export interface FilePattern extends ScopedTemplate {
    type: JournalPageType;
}

export interface PathTemplate extends ScopedTemplate {
    type: JournalPageType;
}

export interface HeaderTemplate extends ScopedTemplate {
}

export interface InlineTemplate extends ScopedTemplate {
    after: string;
}

/** types in the settings.json */
type PatternDefinition = { notes: { path: string, file: string }, entries: { path: string, file: string } };

var DefaultPatternDefinition: PatternDefinition =
{
    notes: {
        path: "${base}/notes",
        file: "N${year}${month}${day}_${input}.${ext}"
    },
    entries: {
        path: "${base}/entries",
        file: "${year}-${month}-${day} ${weekday}.${ext}"
    }
};

type ScopeDefinition = {
    "name": string,
    "base": string,
    "patterns": PatternDefinition,
    "templates": InlineTemplate[]

}

/**
 * Manages access to journal configuration. 
 * 
 * Attention: This is an intermediate implementation, still based on the old configuration pre 0.6
 * 
 */
export class Configuration {


    private patterns: Map<string, ScopedTemplate> = new Map();


    constructor(public config: vscode.WorkspaceConfiguration) {

    }



    public getLocale(): string {
        let locale: string | undefined = this.config.get<string>('locale');
        return (isNullOrUndefined(locale) || (locale!.length === 0)) ? 'en-US' : locale!;
    }


    /**
     * Returns all known scopes in the settings
     */
    public getScopes(): string[] {
        let res = [SCOPE_DEFAULT];
        let scopes: ScopeDefinition[] | undefined = this.config.get<[ScopeDefinition]>("scopes");
        if (isNotNullOrUndefined(scopes) && scopes!.length > 0) {
            this.config.get<[ScopeDefinition]>("scopes")?.map(sd => sd.name).forEach(name => res.push(name));
        }
        return res;
    }

    /**
     * The base path, defaults to %USERPROFILE"/Journal
     * 
     * Supported variables: ${homeDir}
     * 
     * @param _scopeId 
     */
    public getBasePath(_scopeId?: string): string {
        let scope: string = this.resolveScope(_scopeId);


        if (scope == SCOPE_DEFAULT) {
            let base: string | undefined = this.config.get<string>('base');

            if (!isNullOrUndefined(base) && base!.length > 0) {
                const workspaceRoot = vscode.workspace.workspaceFolders?.length && vscode.workspace.workspaceFolders[0].uri.fsPath || '';
                // resolve homedir
                base = base.replace("${homeDir}", os.homedir()).replace("${workspaceRoot}", workspaceRoot);
                base = Path.normalize(base);
                return Path.format(Path.parse(base));
            } else {
                // let's default to user profile
                return Path.resolve(os.homedir(), "Journal");
            }
        } else {
            // there is scope in the request, let's take the base from the scope definition (if it exists)
            let scopes: ScopeDefinition[] | undefined = this.config.get<[ScopeDefinition]>('scopes');
            if (!isUndefined(scopes)) {
                let base: string[] = scopes.filter(v => v.name == scope)
                    .map(scopeDefinition => scopeDefinition.base)
                    .map(scopedBase => {

                        scopedBase = scopedBase.replace("${homeDir}", os.homedir());
                        scopedBase = Path.normalize(scopedBase);
                        return Path.format(Path.parse(scopedBase));
                    });
                if (base.length == 0) return this.getBasePath();
                else return base[0]; // we always take the first
            }

        }

        throw new Error("Failed to resolve base path");

    }

    /**
     * Configuration of file extension for notes and journal entries. Defaults to "md" for markdown. 
     * 
     * 
     * @param _scopeId 
     */
    public getFileExtension(_scopeId?: string): string {
        if (!isNullOrUndefined(_scopeId)) {
            console.error("You requested a scoped file extensions, this is not supported.");
        }

        let ext: string | undefined = this.config.get<string>('ext');
        ext = (isNullOrUndefined(ext) && (ext!.length === 0)) ? 'md' : ext;

        if (ext!.startsWith(".")) { ext = ext!.substring(1, ext!.length); }

        return ext!;
    }

    /**
     * Configuration for the path, where the notes are to be placed
     * 
     * Supported variables: homeDir, base, year, month, day, moment
     * 
     * @param _scopeId default or individual
     */
    public getNotesPathPattern(date: Date, _scopeId?: string): Q.Promise<ScopedTemplate> {
        return Q.Promise((onSuccess, onError) => {
            try {
                let definition: string | undefined;
                let scopedTemplate: ScopedTemplate = {
                    scope: SCOPE_DEFAULT,
                    template: ""
                }
                if (this.resolveScope(_scopeId) == SCOPE_DEFAULT) {
                    definition = this.config.get<PatternDefinition>("pattern")?.notes?.path;
                } else {
                    definition = this.config.get<ScopeDefinition[]>("scopes")?.filter(sd => sd.name == _scopeId).pop()?.patterns?.notes?.path;
                    scopedTemplate.scope = _scopeId!;
                }

                if (isNullOrUndefined(definition) || definition.length == 0) {
                    definition = DefaultPatternDefinition.notes.path;
                }
                scopedTemplate.template = definition;
                scopedTemplate.value = scopedTemplate.template;

                scopedTemplate.value = this.replaceVariableValue("homeDir", os.homedir(), scopedTemplate.value);
                scopedTemplate.value = this.replaceVariableValue("base", this.getBasePath(_scopeId), scopedTemplate.value);
                scopedTemplate.value = this.replaceDateFormats(scopedTemplate.value, date);

                onSuccess(scopedTemplate);
            } catch (error) {
                onError(error);
            }

        });
    }

    /**
     * Configuration for the filename, under which the notes file is stored
     * 
     * Supported variables: year, month, day, df, ext, input
     * 
     * @param _scopeId default or individual
     */
    public getNotesFilePattern(date: Date, input: string, _scopeId?: string): Q.Promise<ScopedTemplate> {
        return Q.Promise((onSuccess, onError) => {
            try {
                let definition: string | undefined;
                let scopedTemplate: ScopedTemplate = {
                    scope: SCOPE_DEFAULT,
                    template: ""
                }
                if (this.resolveScope(_scopeId) == SCOPE_DEFAULT) {
                    definition = this.config.get<PatternDefinition>("pattern")?.notes?.file;
                } else {
                    definition = this.config.get<ScopeDefinition[]>("scopes")?.filter(sd => sd.name == _scopeId).pop()?.patterns?.notes?.file;
                    scopedTemplate.scope = _scopeId!;
                }

                if (isNullOrUndefined(definition) || definition.length == 0) {
                    definition = DefaultPatternDefinition.notes.file;
                }
                scopedTemplate.template = definition;

                scopedTemplate.value = this.replaceVariableValue("ext", this.getFileExtension(), scopedTemplate.template);
                scopedTemplate.value = this.replaceVariableValue("input", input, scopedTemplate.value);
                scopedTemplate.value = this.replaceDateFormats(scopedTemplate.value, date);

                onSuccess(scopedTemplate);
            } catch (error) {
                onError(error);
            }

        });
    }

    /**
     * Configuration for the path, under which the  journal entry  file is stored
     * 
     * Supported variables: base, year, month, day, df
     * 
     * @param _scopeId default or individual
     */
    public getEntryPathPattern(date: Date, _scopeId?: string): Q.Promise<ScopedTemplate> {
        return Q.Promise((onSuccess, onError) => {
            try {
                let definition: string | undefined;
                let scopedTemplate: ScopedTemplate = {
                    scope: SCOPE_DEFAULT,
                    template: ""
                }
                if (this.resolveScope(_scopeId) == SCOPE_DEFAULT) {
                    definition = this.config.get<PatternDefinition>("patterns")?.entries?.path;
                } else {
                    definition = this.config.get<ScopeDefinition[]>("scopes")?.filter(sd => sd.name == _scopeId).pop()?.patterns?.entries?.path;
                    scopedTemplate.scope = _scopeId!;
                }

                if (isNullOrUndefined(definition) || definition.length == 0) {
                    definition = DefaultPatternDefinition.entries.path;
                }
                scopedTemplate.template = definition;


                // resolve variables
                scopedTemplate.value = this.replaceVariableValue("base", this.getBasePath(_scopeId), scopedTemplate.template);
                scopedTemplate.value = this.replaceDateFormats(scopedTemplate.value, date);

                // clean path
                scopedTemplate.value = Path.normalize(scopedTemplate.value);

                onSuccess(scopedTemplate);
            } catch (error) {
                onError(error);
            }

        });
    }
    /**
   * Configuration for the filename, under which the journal entry file is stored
   * 
   * Supported variables: year, month, day, moment, ext
   * 
   * @param _scopeId default or individual
   * 
   * Update 05-2020: Really support scopes, directly access config to support live reloading
   */
    public getEntryFilePattern(date: Date, _scopeId?: string): Q.Promise<ScopedTemplate> {
        return Q.Promise((onSuccess, onError) => {
            try {
                let definition: string | undefined;
                let scopedTemplate: ScopedTemplate = {
                    scope: SCOPE_DEFAULT,
                    template: ""
                }
                if (this.resolveScope(_scopeId) == SCOPE_DEFAULT) {
                    definition = this.config.get<PatternDefinition>("patterns")?.entries?.file;
                } else {
                    definition = this.config.get<ScopeDefinition[]>("scopes")?.filter(sd => sd.name == _scopeId).pop()?.patterns?.entries?.file;
                    scopedTemplate.scope = _scopeId!;
                }

                if (isNullOrUndefined(definition) || definition.length == 0) {
                    definition = DefaultPatternDefinition.entries.file;
                }
                scopedTemplate.template = definition;

                // resolve variables in template

                scopedTemplate.value = this.replaceVariableValue("ext", this.getFileExtension(_scopeId), scopedTemplate.template);
                scopedTemplate.value = this.replaceDateFormats(scopedTemplate.value, date);

                onSuccess(scopedTemplate);
            } catch (error) {
                onError(error);
            }

        });
    }




    /**
     * Checks whether any embedded expressions with date formats are in the template, and replaces them in the value using the given date. 
     * 
     * @param st
     * @param date 
     */
    // https://regex101.com/r/i5MUpx/1/
    // private regExpDateFormats: RegExp = new RegExp(/\$\{(?:(year|month|day|localTime|localDate|weekday)|(d:\w+))\}/g);
    // fix for #52
    // private regExpDateFormats: RegExp = new RegExp(/\$\{(?:(year|month|day|localTime|localDate|weekday)|(d:\w+))\}/g);
    private regExpDateFormats: RegExp = new RegExp(/\$\{(?:(year|month|day|localTime|localDate|weekday)|(d:[\s\S]+?))\}/g);

    private replaceDateFormats(template: string, date: Date): string {
        let matches: RegExpMatchArray = template.match(this.regExpDateFormats) || [];
        // if (isNullOrUndefined(st.value)) { return st.template; }

        // console.log(JSON.stringify(matches));

        let mom: moment.Moment = moment(date);
        moment.locale(this.getLocale());

        matches.forEach(match => {
            switch (match) {
                case "${year}":
                    template = template.replace(match, mom.format("YYYY")); break;
                case "${month}":
                    template = template.replace(match, mom.format("MM")); break;
                case "${day}":
                    template = template.replace(match, mom.format("DD")); break;
                case "${localTime}":
                    template = template.replace(match, mom.format("LT")); break;
                case "${localDate}":
                    template = template.replace(match, mom.format("LL")); break;
                case "${weekday}":
                    template = template.replace(match, mom.format("dddd")); break;
                default:
                    // check if custom format
                    if (match.startsWith("${d:")) {

                        let modifier = match.substring(match.indexOf("d:") + 2, match.length - 1); // includes } at the end
                        // st.template = st.template.replace(match, mom.format(modifier));
                        // fix for #51
                        template = template.replace(match, mom.format(modifier));
                        break;
                    }
                    break;
            }
        });

        return template;
    }



    /**
     * Output format for calender format of moment.js, see https://momentjs.com/docs/#/displaying/calendar-time/
     * 
     * Used in the quickpicker description. The default also includes the time, which we don't want. 
     * 
     * FIXME: Externalise to properties (multilanguage)
     */
    public getInputDetailsTimeFormat() {
        let labels: string[] = new Array(4);

        if (this.getLocale().startsWith("en")) {
            labels = ["for today", "for tomorrow", "for yesterday", "last"]
        } else if (this.getLocale().startsWith("de")) {
            labels = ["für heute", "für morgen", " für gestern", "letzten"]
        } else if (this.getLocale().startsWith("fr")) {
            labels = ["pour aujourd'hui", "pour demain", "d'hier"]
        } else if (this.getLocale().startsWith("es")) {
            labels = ["para hoy", "de mañana", "de ayer", "del último"]
        }

        let config = {
            sameDay: `[${labels[0]}]`,
            nextDay: `[${labels[1]}]`,
            nextWeek: 'dddd',
            lastDay: `[${labels[2]}]`,
            lastWeek: `[${labels[3]}] dddd`,
            sameElse: 'DD/MM/YYYY'
        }

        return config;

        /*  
            Memo der Seite für morgen hinzufügen
            Add memo to the page for tomorrow
            Ajouter un mémo à la page pour demain
            Añadir un memo a la página de mañana

            Añadir un memo a la página de ayer

        */
    }


    public getInputDetailsStringForEntry(dayAsString: string) {
        if (this.getLocale().startsWith("en")) {
            return `Create or open entry ${dayAsString}`;
        } else if (this.getLocale().startsWith("de")) {
            return `Eintrag für ${dayAsString} erstellen oder öffnen`;
        } else if (this.getLocale().startsWith("fr")) {
            return `Créer ou ouvrir une entrée ${dayAsString}`;
        } else if (this.getLocale().startsWith("es")) {
            return `Crear o abrir una entrada  ${dayAsString}`;
        } else {
            return `Create or open entry ${dayAsString}`;
        }
    }


    /**
     * Generates the details for the QuickPick Box (when creating a task)
     * 
     * FIXME: Externalize to properties
     * @param dayAsString 
     */
    public getInputDetailsStringForMemo(dayAsString: string) {
        // if (this.getLocale().startsWith("en")) {
        //     return `Add memo to entry ${dayAsString}`;
        // } else {
        return `Add memo to entry ${dayAsString}`;
        // }
    }


    private labelTranslations: Map<string, string> = new Map();
    public getInputLabelTranslation(code: number) {
        if (this.labelTranslations.size == 0) {
            this.labelTranslations.set("en" + 1, "Today");
            this.labelTranslations.set("en" + 2, "Yesterday");
            this.labelTranslations.set("en" + 3, "Tomorrow");
            this.labelTranslations.set("en" + 4, "Select entry");
            this.labelTranslations.set("en" + 5, "Select/Create a note");
            this.labelTranslations.set("en" + 6, "Select attachement");
        }
        let val = this.labelTranslations.get(this.getLocale().substring(0, 2) + code);
        if (isUndefined(val)) val = this.labelTranslations.get("en" + code);

        return <string>val;

    }

    private descTranslations: Map<string, string> = new Map();
    public getInputDetailsTranslation(code: number): string | undefined {
        if (this.descTranslations.size == 0) {
            this.descTranslations.set("en" + 1, "Jump to today's entry.");
            this.descTranslations.set("en" + 2, "Jump to yesterday's entry.");
            this.descTranslations.set("en" + 3, "Jump to tomorrow's entry.");
            this.descTranslations.set("en" + 4, "Select from the last journal entries.");
            this.descTranslations.set("en" + 5, "Create a new note or select from recently created or updated notes.");
            this.descTranslations.set("en" + 6, "Select from the list of recently added attachements.");
        }
        let val = this.descTranslations.get(this.getLocale().substring(0, 2) + code);
        if (isUndefined(val)) val = this.labelTranslations.get("en" + code);
        return <string>val;

    }

    /**
     * Helper Method, threshold (maximal age) of files shown in the quick picker
     */
    getInputTimeThreshold(): number {
        let offset = -60;
        let d: Date = new Date();
        d.setDate(d.getDate() + offset);
        return d.getTime();
    }


    /**
     *
     * Retrieves the (scoped) inline template for a journal entry. 
     * 
     * Supported variables: localDate, year, month, day, format
     * 
     * Default value is: "# ${localDate}\n\n",
     * @param {string} [_scopeId]
     * @returns {Q.Promise<FileTemplate>}
     * @memberof Configuration
     */
    public getEntryTemplate(date: Date, _scopeId?: string): Q.Promise<HeaderTemplate> {
        return this.getInlineTemplate("entry", "# ${localDate}\n\n", this.resolveScope(_scopeId))
            .then((sp: ScopedTemplate) => {

                // backwards compatibility, replace {content} with ${input} as default
                sp.template = sp.template.replace("{content}", "${localDate}");

                sp.value = this.replaceDateFormats(sp.template, date);
                sp.value = this.replaceVariableValue("base", this.getBasePath(_scopeId), sp.value);

                return sp;
            });
    }

    /**
       * Retrieves the (scoped) file template for a note. 
       * 
       * Default value is: "# ${input}\n\n",
       *
       * @param {string} [_scopeId]  identifier of the scope
       * @returns {Q.Promise<FileTemplate>} scoped file template for notes
       * @memberof Configuration 
       */
    public getNotesTemplate(_scopeId?: string): Q.Promise<HeaderTemplate> {
        return this.getInlineTemplate("note", "# ${input}\n${tags}\n", this.resolveScope(_scopeId))
            .then((result: ScopedTemplate) => {
                // backwards compatibility, replace {content} with ${input} as default
                result.template = result.template.replace("{content}", "${input}");

                result.value = this.replaceDateFormats(result.template, new Date());

                return result;
            });
    }

    public isDevelopmentModeEnabled(): boolean {
        let dev: boolean | undefined = this.config.get<boolean>('dev');
        return (!isNullOrUndefined(dev)) ? dev! : false;
    }

    public isOpenInNewEditorGroup(): boolean {
        let res: boolean | undefined = this.config.get<boolean>('openInNewEditorGroup');
        return (!isNullOrUndefined(res)) ? res! : false;
    }


    /***** PRIVATES *******/

    /**
     * Returns a valid scope, falls back to default. 
     * 
     * @param _scopeId 
     */
    private resolveScope(_scopeId?: string): string {
        return (isNullOrUndefined(_scopeId) || (_scopeId!.length === 0)) ? SCOPE_DEFAULT : _scopeId!;
    }

    // /**
    //  * Returns the pattern with the given id (loads them from vscode config if needed)
    //  * 
    //  * @param id 
    //  * @deprecated
    //  */
    // private getPatternX(id: string): Q.Promise<ScopedTemplate> {
    //     return Q.Promise<ScopedTemplate>((resolve, reject) => {
    //         try {
    //             this.loadPatternsX()
    //                 .then(b => {
    //                     let tpl: ScopedTemplate = <ScopedTemplate>this.patterns.get(id);
    //                     tpl.value = tpl.template;  // reset template
    //                     resolve(tpl);
    //                 });
    //         } catch (error) {
    //             reject(error);
    //         }

    //     });
    // }

    private replaceVariableValue(key: string, value: string, template: string): string {
        if (template.search("\\$\\{" + key + "\\}") >= 0) {
            return template.replace("${" + key + "}", value);
        } else {
            return template;
        }
    }

    private replaceVariableInTemplate(key: string, value: string, st: ScopedTemplate): void {
        if (Util.stringIsNotEmpty(st.template)) {
            if (st.template!.search("\\$\\{" + key + "\\}") >= 0) {
                st.template = st.template!.replace("${" + key + "}", value);
            }
        } else {
            console.error("Tried to replace variable in empty string.")
        }


    }


    /**
     * 
     * @param _id 
     * @param _defaultValue 
     * @param _scopeId 
     */
    private getInlineTemplate(_id: string, _defaultValue: string, _scopeId: string): Q.Promise<InlineTemplate> {
        return Q.Promise<InlineTemplate>((resolve, reject) => {
            try {
                let scope = this.resolveScope(_scopeId);

                // legacy mode, support old config values
                if (Util.stringIsNotEmpty(this.config.get<string>("tpl-" + _id))) {
                    resolve({
                        name: _id,
                        scope: SCOPE_DEFAULT,
                        template: this.config.get<string>("tpl-" + _id)!,
                        after: Util.stringIsNotEmpty(this.config.get<string>(_id + '-after')) ? this.config.get<string>(_id + '-after')! : ''
                    });

                    return;
                };


                let pattern: InlineTemplate | undefined;
                if (scope == SCOPE_DEFAULT) {
                    pattern = this.config.get<InlineTemplate[]>("templates")?.filter(tpl => tpl.name == _id).pop();
                } else {
                    // a scope was requested
                    this.config.get<ScopeDefinition[]>("scopes")?.filter(sd => sd.name = scope).pop()?.templates?.filter(tpl => tpl.name == _id)?.pop();
                }

                if (Util.isNullOrUndefined(pattern)) {
                    resolve({
                        name: _id,
                        scope: SCOPE_DEFAULT,
                        template: _defaultValue,
                        after: ''
                    })
                } else {
                    // safeguards which should never trigger
                    if (Util.isNullOrUndefined(pattern?.after)) pattern!.after = '';
                    if (Util.isNullOrUndefined(pattern?.template)) pattern!.after = _defaultValue;
                    resolve(pattern!)
                }
            } catch (error) {
                reject(error);
            }

        });
    }


    // /** 
    //  * Loads the patterns if needed from the vscode configuration. 
    //  */
    // private loadPatternsX(): Q.Promise<boolean> {
    //     return Q.Promise<boolean>((resolve, reject) => {
    //         if (this.patterns.size > 0) {
    //             resolve(true);
    //             return;
    //         }

    //         let config: PatternDefinition | undefined = this.config.get<PatternDefinition>('patterns');

    //         //FIXME: support scopes
    //         try {
    //             if (isNullOrUndefined(config)) {
    //                 config = {
    //                     notes: {
    //                         path: "${base}/${year}/${month}/${day}",
    //                         file: "${input}.${ext}"
    //                     },
    //                     entries: {
    //                         path: "${base}/${year}/${month}",
    //                         file: "${day}.${ext}"
    //                     }
    //                 };
    //             }

    //             // setting the default patterns
    //             this.patterns.set("default.pattern.notes.path",
    //                 {
    //                     name: "default.pattern.notes.path",
    //                     scope: "default",
    //                     template: config.notes.path
    //                 });
    //             this.patterns.set("default.pattern.notes.file",
    //                 {
    //                     name: "default.pattern.notes.file",
    //                     scope: "default",
    //                     template: config.notes.file
    //                 });
    //             this.patterns.set("default.pattern.entries.path",
    //                 {
    //                     name: "default.pattern.entries.path",
    //                     scope: "default",
    //                     template: config.entries.path
    //                 });
    //             this.patterns.set("default.pattern.entries.file",
    //                 {
    //                     name: "default.pattern.entries.file",
    //                     scope: "default",
    //                     template: config.entries.file
    //                 });


    //             // TODO: setting the scoped patterns



    //             resolve(true);
    //         } catch (error) {
    //             reject(error);
    //         }
    //     });
    // }



}