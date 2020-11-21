// Copyright (C) 2017  Patrick Maué
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

import * as moment from 'moment';
import * as Q from 'q';
import { isError, isNullOrUndefined, isString } from 'util';
import * as vscode from 'vscode';
import * as J from '../.';
import { SelectedInput, NoteInput } from '../model/input';

export interface Commands {
    processInput(): Q.Promise<vscode.TextEditor | null>;
    showNote(): Q.Promise<vscode.TextEditor | null>;
    showEntry(offset: number): Q.Promise<vscode.TextEditor>;
    loadJournalWorkspace(): Q.Promise<void>;

    //editJournalConfiguration(): Thenable<vscode.TextEditor>
}


export class JournalCommands implements Commands {

    /**
     *
     */
    constructor(public ctrl: J.Util.Ctrl) {
    }
    /**
     * Opens the editor for a specific day. Supported values are explicit dates (in ISO format),
     * offsets (+ or - as prefix and 0) and weekdays (next wednesday) 
     * 
     * Update: supports much more now
     */
    public processInput(): Q.Promise<vscode.TextEditor> {


        this.ctrl.logger.trace("Entering processInput() in ext/commands.ts");

        let deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();
        this.ctrl.ui.getUserInputWithValidation()
            .then((input: J.Model.Input) => this.loadPageForInput(input))
            .then((document: vscode.TextDocument) => this.ctrl.ui.showDocument(document))
            .then((editor: vscode.TextEditor) => deferred.resolve(editor))
            .catch((error: any) => {
                if (error !== 'cancel') {
                    this.ctrl.logger.error("Failed to process input.", error);
                    deferred.reject(error);
                } else {
                    deferred.reject("cancel");
                }
            });
        return deferred.promise;
    }

    /**
     * Called by command 'Journal:open'. Opens a new windows with the Journal base directory as root. 
     *
     * @returns {Q.Promise<void>}
     * @memberof JournalCommands
     */
    public loadJournalWorkspace(): Q.Promise<void> {
        this.ctrl.logger.trace("Entering loadJournalWorkspace() in ext/commands.ts");

        var deferred: Q.Deferred<void> = Q.defer<void>();

        let path = vscode.Uri.file(this.ctrl.config.getBasePath());
        vscode.commands.executeCommand('vscode.openFolder', path, true)
            .then(success => {
                deferred.resolve();
            },
                error => {
                    this.ctrl.logger.error("Failed to open journal workspace.", error);
                    deferred.reject("Failed to open journal workspace.");
                });

        return deferred.promise;
    }

    /**
     * Implements commands "yesterday", "today", "yesterday", where the input is predefined (no input box appears)
     * @param offset 
     */
    public showEntry(offset: number): Q.Promise<vscode.TextEditor> {
        this.ctrl.logger.trace("Entering showEntry() in ext/commands.ts");

        var deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();

        let input = new J.Model.Input();
        input.offset = offset;

        this.loadPageForInput(input)
            .then((doc: vscode.TextDocument) => this.ctrl.ui.showDocument(doc))
            .then((editor: vscode.TextEditor) => deferred.resolve(editor))
            .catch((error: any) => {
                if (error !== 'cancel') {
                    this.ctrl.logger.error("Failed to get file, Reason: ", error);
                }
                deferred.reject(error);
            })
            .done();

        return deferred.promise;
    }



    /**
     * Creates a new file in a subdirectory with the current day of the month as name.
     * Shows the file to let the user start adding notes right away.
     *
     * @returns {Q.Promise<vscode.TextEditor>}
     * @memberof JournalCommands
     */
    public showNote(): Q.Promise<vscode.TextEditor | null> {
        this.ctrl.logger.trace("Entering showNote() in ext/commands.ts");

        var deferred: Q.Deferred<vscode.TextEditor | null> = Q.defer<vscode.TextEditor | null>();

        this.ctrl.ui.getUserInput("Enter title for new note")
            .then((inputString: string) => this.ctrl.parser.parseInput(inputString))
            .then((input: J.Model.Input) =>
                Q.all([
                    this.ctrl.parser.resolveNotePathForInput(input),
                    this.ctrl.inject.buildNoteContent(input)
                ])
            )
            .then(([path, content]) =>
                this.ctrl.reader.loadNote(path, content))
            .then((doc: vscode.TextDocument) =>
                this.ctrl.ui.showDocument(doc))
            .then((editor: vscode.TextEditor) => {


                //  
                return editor;
            })
            .then((editor: vscode.TextEditor) => {

                deferred.resolve(editor);
            })
            .catch(reason => {
                if (reason !== 'cancel') {
                    this.ctrl.logger.error("Failed to load note", reason)
                    deferred.reject(reason);
                } else { deferred.resolve(null); }
            })
            .done();

        return deferred.promise;
    }


    public showError(error: string | Q.Promise<string> | Error): void {

        if (Q.isPromise(error)) {
            (<Q.Promise<string>>error).then((value) => {
                // conflict between Q.IPromise and vscode.Thenable
                this.showErrorInternal(value);
            }).catch(err => {
                (<Q.Promise<string>>error).catch(error => {
                    this.showError(JSON.stringify(error));
                });
            })
        }

        if (isString(error)) {
            this.showErrorInternal(error);
        }

        if (isError(error)) {
            this.showErrorInternal(error.message);
        }
    }

    private showErrorInternal(errorMessage: string): void {
        let hint = "Check logs.";
        vscode.window.showErrorMessage(errorMessage, hint)
            .then(clickedHint => {
                this.ctrl.logger.channel.show();
            });
    }

    /**
     * Expects any user input from the magic input and either opens the file or creates it. 
     * @param input 
     */
    private loadPageForInput(input: J.Model.Input): Q.Promise<vscode.TextDocument> {
        this.ctrl.logger.trace("Entering loadPageForInput() in ext/commands.ts");

        if (input instanceof SelectedInput) {
            // we just load the path
            return this.ctrl.ui.openDocument((<SelectedInput>input).path);
        } if (input instanceof NoteInput) {
            // we create or load the notes
            return this.ctrl.inject.buildNoteContent(input)
                .then(content => this.ctrl.reader.loadNote(input.path, content));
        } else {
            return this.ctrl.reader.loadEntryForInput(input);
        }
    }
}
