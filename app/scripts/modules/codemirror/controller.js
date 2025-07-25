/**
 * Copyright (C) 2015 Laverna project Authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/* global define */
define([
    'underscore',
	'jquery',
    'marionette',
    'backbone.radio',
    'ali-oss',
    'axios',
    'constants',
    'codemirror/lib/codemirror',
    'modules/codemirror/views/editor',
    'codemirror/mode/gfm/gfm',
    'codemirror/mode/markdown/markdown',
    'codemirror/addon/edit/continuelist',
    'codemirror/addon/mode/overlay',
    'codemirror/keymap/vim',
    'codemirror/keymap/emacs',
    'codemirror/keymap/sublime',
    'recordrtc'
], function(_, $, Marionette, Radio, OSS, axios, constants, CodeMirror, View) {
    'use strict';

    /**
     * Codemirror module.
     * Regex and WYSIWG button functions are based on simplemde-markdown-editor:
     * https://github.com/NextStepWebs/simplemde-markdown-editor
     */
    var Controller = Marionette.Object.extend({

        marks: {
            strong: {
                tag   : ['**', '__'],
                start : /(\*\*|__)(?![\s\S]*(\*\*|__))/,
                end   : /(\*\*|__)/,
            },
            em: {
                tag   : ['*', '_'],
                start : /(\*|_)(?![\s\S]*(\*|_))/,
                end   : /(\*|_)/,
            },
            strikethrough: {
                tag   : ['~~'],
                start : /(\*\*|~~)(?![\s\S]*(\*\*|~~))/,
                end   : /(\*\*|~~)/,
            },
            'code': {
                tag    : '```\r\n',
                tagEnd : '\r\n```',
            },
            'unordered-list': {
                replace : /^(\s*)(\*|\-|\+)\s+/,
                tag     : '* ',
            },
            'ordered-list': {
                replace : /^(\s*)\d+\.\s+/,
                tag     : '1. ',
            },
        },

        initialize: function() {
            _.bindAll(this, 'onChange', 'onScroll', 'onCursor', 'boldAction', 'italicAction', 'linkAction', 'headingAction', 'attachmentAction', 'codeAction', 'hrAction', 'listAction', 'numberedListAction', 'recordStartAction', 'aiSummaryAction');

            // Get configs
            this.configs = Radio.request('configs', 'get:object');

            // Initialize the view
            this.view = new View({
                model   : Radio.request('notesForm', 'model'),
                configs : this.configs
            });

            this.view.once('dom:refresh', this.initEditor, this);

            // Events
            this.listenTo(this.view, 'editor:action', this.onViewAction);
            this.listenTo(Radio.channel('notesForm'), 'set:mode', this.changeMode);
            this.listenTo(Radio.channel('editor'), 'focus', this.focus);

            // Show the view and render Pagedown editor
            Radio.request('notesForm', 'show:editor', this.view);

            Radio.reply('editor', {
                'get:data'      : this.getData,
                'generate:link' : this.generateLink,
                'generate:image': this.generateImage,
                'ai:summary:recording': this.getRecording,
                'ai:summary:transcription': this.generateSummary,
            }, this);

			// Init footer to show current line numbers
			// but first of hide it, because when you open/add a note
			// the title is focused, not the editor
			this.footer = $('#editor--footer');
			this.footer.hide();

        },

        onDestroy: function() {
            Radio.stopReplying('editor', 'get:data');
        },

        initEditor: function() {
            this.editor = CodeMirror.fromTextArea(document.getElementById('editor--input'), {
                mode          : {
                    name        : 'gfm',
                    gitHubSpice : false
                },
				keyMap: this.configs.textEditor || 'default',
                lineNumbers   : false,
                matchBrackets : true,
                lineWrapping  : true,
                indentUnit    : parseInt(this.configs.indentUnit, 10),
                extraKeys     : {
                    'Cmd-B'  : this.boldAction,
                    'Ctrl-B' : this.boldAction,

                    'Cmd-I'  : this.italicAction,
                    'Ctrl-I' : this.italicAction,

                    'Cmd-H'  : this.headingAction,
                    'Ctrl-H' : this.headingAction,

                    'Cmd-L'  : this.linkAction,
                    'Ctrl-L' : this.linkAction,

                    'Cmd-K'  : this.codeAction,
                    'Ctrl-K' : this.codeAction,

                    'Cmd-O'  : this.numberedListAction,
                    'Ctrl-O' : this.numberedListAction,

                    'Cmd-U'  : this.listAction,
                    'Ctrl-U' : this.listAction,

                    // Ctrl+G - attach file
                    'Cmd-G'  : this.attachmentAction,
                    'Ctrl-G' : this.attachmentAction,
                    
                    // Shift+Ctrl+- - divider
                    'Shift-Cmd--'   : this.hrAction,
                    'Shift-Ctrl--'  : this.hrAction,

					// Ctrl+. - indent line
					'Ctrl-.' 		: 'indentMore',
					'Shift-Ctrl-.' 	: 'indentLess',
					'Cmd-.' 		: 'indentMore',
					'Shift-Cmd-.'	: 'indentLess',

                    'Enter' : 'newlineAndIndentContinueMarkdownList',

                }
            });

            window.dispatchEvent(new Event('resize'));
            this.editor.on('change', this.onChange);
            this.editor.on('scroll', this.onScroll);
            this.editor.on('cursorActivity', this.onCursor);

            // Show the preview
            this.updatePreview();
        },

        changeMode: function(mode) {
            window.dispatchEvent(new Event('resize'));
            this.view.trigger('change:mode', mode);
        },

        /**
         * Update the preview.
         */
        updatePreview: function() {
            var self = this,
                data = _.pick(this.view.model, 'attributes', 'files');

            return Radio.request('markdown', 'render', _.extend({}, data, {
                attributes: {
                content: this.editor.getValue()
                }
        }))
        .then(function(content) {
                self.view.trigger('editor:change', content);
            });
        },

        /**
         * Start recording using RecordRTC.
         */
        recordStartAction: function() {
            console.log('Step into recordStartAction');
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then((stream) => {
                    if (this.recorder) {
                        console.log('recorder state: ', this.recorder.getState());
                        if(this.recorder.getState() === 'recording') {
                            console.log('Stop recording');
                            this.recorder.stopRecording();
                            this.recorder.destroy();
                            this.recorder = null;
                            Radio.trigger('editor', 'ai:summary:recording:stop');
                        }
                    } else {
                        this.recorder = new RecordRTC(stream, {
                            type: 'audio'
                        });
                        console.log('Start recording');
                        this.recorder.startRecording();
                        Radio.trigger('editor', 'ai:summary:recording:start');
                    }

                })
                .catch((error) => {
                    console.error('Error accessing microphone:', error);
                    Radio.trigger('editor', 'ai:summary:recording:error', error);
                });
        },

        /**
         * Get the recorded audio.
         */
        getRecording: function() {
            console.log('Step into getRecording');
            if (this.recorder) {
                return new Promise((resolve) => {
                    this.recorder.stopRecording(() => {
                        const blob = this.recorder.getBlob();
                        resolve(blob);
                        this.recorder.destroy();
                        this.recorder = null;
                        Radio.trigger('editor', 'ai:summary:recording:stop');
                    });
                });
            }
            return Promise.resolve(null);
        },

        aiSummaryAction: function() {
            console.log('Step into aiSummaryAction');
            this.getRecording().then((blob) => {
                if (blob) {
                    const now = new Date();
                    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
                    const fileName = `recording_${timestamp}.mp3`;

                    // 初始化OSS客户端
                    const client = new OSS({
                        region: constants.OSS_REGION,
                        accessKeyId: constants.OSS_ACCESS_KEY_ID,
                        accessKeySecret: constants.OSS_ACCESS_KEY_SECRET,
                        authorizationV4: true,
                        bucket: constants.OSS_BUCKET
                    });

                    // 自定义请求头
                    const headers = {
                    'x-oss-storage-class': 'Standard', // 指定Object的存储类型。
                    'x-oss-object-acl': 'public-read', // 指定Object的访问权限。
                    'Content-Disposition': 'attachment; filename=' + fileName, // 通过文件URL访问文件时，指定以附件形式下载文件，下载后的文件名称定义为fileName。
                    'x-oss-tagging': 'Tag1=1&Tag2=2', // 设置Object的标签，可同时设置多个标签。
                    'x-oss-forbid-overwrite': 'true', // 指定PutObject操作时是否覆盖同名目标Object。此处设置为true，表示禁止覆盖同名Object。
                    };

                    // 上传文件到OSS
                    client.put(fileName, blob, { headers }).then(result => {
                        console.log('文件上传成功:', result);

                        // 生成Markdown链接并插入编辑器
                        const markdownLink = `## 课程录音附件\n\n[${fileName}](${result.url})` + "\n";
                        this.editor.replaceSelection(markdownLink);

                        const paraformerTaskCreator = axios.create({
                            baseURL: 'https://dashscope.aliyuncs.com',
                            headers: {
                                'Authorization': 'Bearer ' + constants.PARAFORMER_API_KEY,
                                'Content-Type': 'application/json',
                                'X-DashScope-Async': 'enable'
                            }
                        });
                        // Use axios to create paraformer task with result.url
                        paraformerTaskCreator.post('/api/v1/services/audio/asr/transcription', {
                                "model": "paraformer-v2",
                                "input": { "file_urls": [ result.url ] },
                                "parameters": { //仅v2及之后系列模型支持，v1系列模型不要使用该字段
                                    //"vocabulary_id":"vocab-Xxxx", //最新热词ID，可选
                                    "channel_id":[0], //音轨索引，可选
                                    "disfluency_removal_enabled":false, //过滤语气词开关，可选
                                    "timestamp_alignment_enabled": false, //是否启用时间戳校准功能，可选
                                    //"special_word_filter": "xxx", //敏感词，可选
                                    "language_hints":[ // 当前该参数仅适用于paraformer-v2模型，其他模型不要使用该字段
                                        "zh",
                                        "en"
                                    ],
                                    "diarization_enabled":false, //自动说话人分离，可选
                                    //"speaker_count": 2 //说话人数量参考，可选
                                }
                            }
                        )
                        .then(response => {
                            console.log('Paraformer API response:', response.data);
                            const data = response.data;
                            // Use axios to query paraformer task info.
                            const taskStatus = data.output.task_status;
                            if( taskStatus === 'SUCCEEDED' || taskStatus === 'PENDING' || taskStatus === 'RUNNING') {
                                // Query task info
                                const taskId = data.output.task_id;
                                console.log(`Task created with (${taskStatus}), starting polling for task ID: ${taskId}`);

                                // 设置轮询参数
                                const pollInterval = 3000; // 3秒轮询一次
                                const maxAttempts = 20; // 最大尝试次数
                                let attempts = 0;

                                // 轮询函数
                                console.log('Start polling task status: ' + taskId);
                                const pollTaskStatus = () => {
                                    axios.get(constants.PARAFORMER_API_TASK_URL + taskId, {
                                        headers: {
                                            'Authorization': 'Bearer ' + constants.PARAFORMER_API_KEY,
                                        },
                                    }).then(response => {
                                        const taskStatus = response.data.output.task_status;
                                        const taskcode = response.data.output.code;
                                        const taskQuiryData = response.data;
                                        console.log(`Task status: ${taskStatus}`);

                                        // 检查任务状态
                                        if (taskStatus === 'SUCCEEDED') {
                                            console.log('Task completed successfully');

                                            const transcription_url = taskQuiryData.output.results[0].transcription_url;
                                            axios.get(transcription_url)
                                            .then(response => {
                                                const transcription = "## 课程录音转写\n\n" + response.data.transcripts[0].text + "\n";
                                                this.editor.replaceSelection(transcription);

                                                // 轮询结束
                                                console.log('Polling stopped');

                                                // Send transcription to summary function
                                                Radio.request('editor', 'ai:summary:transcription', transcription);
                                            })
                                            .catch(err => {
                                                console.error('Error fetching transcription:', err);
                                            });
                                        } else if (taskStatus === 'FAILED') {
                                            if(taskcode === "SUCCESS_WITH_NO_VALID_FRAGMENT") {
                                                console.log('There is no valid content in audio');
                                                this.editor.replaceSelection("## 课程录音转写\n\n" + "无有效内容" + "\n");
                                            } else {
                                                console.error('Task failed');
                                            }
                                        } else {
                                            // 继续轮询
                                            attempts++;
                                            if (attempts < maxAttempts) {
                                                setTimeout(pollTaskStatus, pollInterval);
                                            } else {
                                                console.error('Max polling attempts reached');
                                            }
                                        }
                                    })
                                    .catch(err => {
                                        console.error('Paraformer API response:', err);
                                        attempts++;
                                        if (attempts < maxAttempts) {
                                            setTimeout(pollTaskStatus, pollInterval);
                                        } else {
                                            console.error('Max polling attempts reached');
                                        }
                                    });
                                };

                                // 首次调用轮询函数
                                pollTaskStatus();
                            } else {
                                console.error('Paraformer Query task failed:', taskStatus);
                            }
                        }).catch(err => {
                            console.error('Paraformer API response:', err);
                            alert('Failed to create to Paraformer task, please check your network connection');
                        });

                    // 触发录音状态切换
                    Radio.trigger('editor', 'editor:action', 'recordStart'); 
                }).catch(err => {
                    // 触发录音状态切换
                    Radio.trigger('editor', 'editor:action', 'recordStart');
                    console.error('文件上传失败:', err);
                    alert('音频上传失败, 请检查OSS配置或网络连接');
                });
                } else {
                    console.error('No recording available');
                }
            });
        },

        /**
         * Text in the editor changed.
         */
        onChange: function() {

            // Update the preview
            this.updatePreview();

            // Trigger autosave
            this.autoSave();
        },

        /**
         * Editor's cursor position changed.
         */
        onCursor: function() {
            var state  = this.getState();
            this.$btns = this.$btns || $('.editor--btns .btn');

            // Make a specific button active depending on the type of the element under cursor
            this.$btns.removeClass('btn-primary');
            for (var i = 0; i < state.length; i++) {
                this['$btn' + state[i]] = this['$btn' + state[i]] || $('.editor--btns [data-state="' + state[i] + '"]');
                this['$btn' + state[i]].addClass('btn-primary');
            }

			// Update lines in footer
			this.footer.show();
			var currentLine = this.editor.getCursor('start').line + 1;
			var numberOfLines = this.editor.lineCount();
			this.footer.html($.t('Line of',
				{currentLine: currentLine, numberOfLines: numberOfLines}));
        },

        /**
         * Trigger 'save:auto' event.
         */
        autoSave: _.debounce(function() {
            Radio.trigger('notesForm', 'save:auto');
        }, 1000),

        /**
         * Synchronize the editor's scroll position with the preview's.
         */
        onScroll: _.debounce(function(e) {

            // Don't do any computations
            if (!e.doc.scrollTop) {
                this.view.ui.previewScroll.scrollTop(0);
                return;
            }

            var info       = this.editor.getScrollInfo(),
                lineNumber = this.editor.lineAtHeight(info.top, 'local'),
                range      = this.editor.getRange({line: 0, ch: null}, {line: lineNumber, ch: null}),
                self       = this,
                fragment,
                temp,
                lines,
                els;

            Radio.request('markdown', 'render', range)
            .then(function(html) {

                // Create a fragment and attach rendered HTML
                fragment       = document.createDocumentFragment();
                temp           = document.createElement('div');
                temp.innerHTML = html;
                fragment.appendChild(temp);

                // Get all elements in both the fragment and the preview
                lines = temp.children;
                els   = self.view.ui.preview[0].children;

                // Get from the preview the last visible element of the editor
                var newPos = els[lines.length].offsetTop;

                /**
                 * If the scroll position is on the same element,
                 * change it according to the difference of scroll positions in the editor.
                 */
                if (self.scrollTop && self.scrollPos === newPos) {
                    self.view.ui.previewScroll.scrollTop(self.view.ui.previewScroll.scrollTop() + (e.doc.scrollTop - self.scrollTop));
                    self.scrollTop = e.doc.scrollTop;
                    return;
                }

                // Scroll to the last visible element's position
                self.view.ui.previewScroll.animate({
                    scrollTop: newPos
                }, 70, 'swing');

                self.scrollPos = newPos;
                self.scrollTop = e.doc.scrollTop;
            });
        }, 10),

        /**
         * If the view triggered some action event, call a suitable function.
         * For instance, when action='bold', call boldAction method.
         */
        onViewAction: function(action) {
            action = action + 'Action';

            if (this[action]) {
                this[action]();
            }
        },

        /**
         * Return data from the editor.
         */
        getData: function() {
            var content = this.editor.getValue();

            return Radio.request('markdown', 'parse', content)
            .then(function(env) {
                return _.extend(
                    _.pick(env, 'tags', 'tasks', 'taskCompleted', 'taskAll', 'files'),
                    {content: content}
                );
            });
        },

        /**
         * Return state of the element under the cursor.
         */
        getState: function(pos) {
            pos      = pos || this.editor.getCursor('start');
            var stat = this.editor.getTokenAt(pos);

            if (!stat.type) {
                return [];
            }

            stat.type = stat.type.split(' ');

            if (_.indexOf(stat.type, 'variable-2') !== -1) {
                if (/^\s*\d+\.\s/.test(this.editor.getLine(pos.line))) {
                    stat.type.push('ordered-list');
                }
                else {
                    stat.type.push('unordered-list');
                }
            }


            return stat.type;
        },

        /**
         * Toggle Markdown block.
         */
        toggleBlock: function(type) {
            var stat  = this.getState(),
                start = this.editor.getCursor('start'),
                end   = this.editor.getCursor('end'),
		        text,
		        startText,
		        endText;

            // Text is already [strong|italic|etc]
            if (_.indexOf(stat, type) !== -1) {
                text      = this.editor.getLine(start.line);
                startText = text.slice(0, start.ch);
                endText   = text.slice(start.ch);

                // Remove Markdown tags from the text
                startText = startText.replace(this.marks[type].start, '');
                endText   = endText.replace(this.marks[type].end, '');

                this.replaceRange(startText + endText, start.line);

                start.ch -= this.marks[type].tag[0].length;
                end.ch   -= this.marks[type].tag[0].length;
            }
            else {
                text = this.editor.getSelection();

			    for (var i = 0; i < this.marks[type].tag.length - 1; i++) {
                    text = text.split(this.marks[type].tag[i]).join('');
			    }

		        this.editor.replaceSelection(this.marks[type].tag[0] + text + this.marks[type].tag[0]);

                start.ch += this.marks[type].tag[0].length;
                end.ch    = start.ch + text.length;
            }

            this.editor.setSelection(start, end);
            this.editor.focus();
        },

        /**
         * Make selected text strong.
         */
        boldAction: function() {
            this.toggleBlock('strong');
        },

        /**
         * Make selected text italicized.
         */
        italicAction: function() {
            this.toggleBlock('em');
        },

        /**
         * Create headings.
         */
        headingAction: function() {
            var start = this.editor.getCursor('start'),
                end   = this.editor.getCursor('end');

            for (var i = start.line; i <= end.line; i++) {
                this.toggleHeading(i);
            }
        },

        /**
         * Show a dialog to attach images or files.
         */
        attachmentAction: function() {
            var self   = this,
                dialog = Radio.request('editor', 'show:attachment', this.view.model);

            if (!dialog) {
                return;
            }

            dialog.then(function(text) {
                if (!text || !text.length) {
                    return;
                }

                self.editor.replaceSelection(text, true);
                self.editor.focus();
            });
        },

        /**
         * Show a link dialog.
         */
        linkAction: function() {
            var self   = this,
                dialog = Radio.request('editor', 'show:link');

            if (!dialog) {
                return;
            }

            dialog.then(function(link) {
                if (!link || !link.length) {
                    return;
                }

                var cursor = self.editor.getCursor('start'),
                    text   = self.editor.getSelection() || 'Link';

                self.editor.replaceSelection('[' + text + '](' + link + ')');
                self.editor.setSelection(
                    {line: cursor.line, ch: cursor.ch + 1},
                    {line: cursor.line, ch: cursor.ch + text.length + 1}
                );
                self.editor.focus();
            });
        },

        /**
         * Create a divider.
         */
        hrAction: function() {
            var start = this.editor.getCursor('start');
            this.editor.replaceSelection('\r\r-----\r\r');

            start.line += 4;
            start.ch    = 0;
            this.editor.setSelection( start, start );
            this.editor.focus();
        },

        /**
         * Create a code block.
         */
        codeAction: function() {
            var state = this.getState(),
                start = this.editor.getCursor('start'),
                end   = this.editor.getCursor('end'),
                text;

            if (_.indexOf(state, 'code') !== -1) {
                return;
            }
            else {
                text = this.editor.getSelection();
                this.editor.replaceSelection(this.marks.code.tag + text + this.marks.code.tagEnd);
            }
            this.editor.setSelection({line: start.line + 1, ch: start.ch}, {line: end.line + 1, ch: end.ch});
            this.editor.focus();
        },

        replaceRange: function(text, line) {
            this.editor.replaceRange(text, {
                line : line,
                ch   : 0
            }, {
                line : line,
                ch   : 99999999999999
            });
            this.editor.focus();
        },

        /**
         * Convert a line to a headline.
         */
        toggleHeading: function(i) {
            var text       = this.editor.getLine(i),
			    headingLvl = text.search(/[^#]/);

            // Create a default headline
            if (headingLvl === -1) {
                text = '# Heading';

                this.replaceRange(text, i);
                return this.editor.setSelection(
                    {line: i, ch: 2},
                    {line: i, ch: 9}
                );
            }

            // Increase headline level up to 6th
            if (headingLvl < 6) {
                text = headingLvl > 0 ? text.substr(headingLvl + 1) : text;
                text = new Array(headingLvl + 2).join('#') + ' ' + text;
            }
            else {
                text = text.substr(headingLvl + 1);
            }

            this.replaceRange(text, i);
        },

        /**
         * Convert selected text to unordered list.
         */
        listAction: function() {
            this.toggleLists('unordered-list');
        },

        /**
         * Convert selected text to ordered list.
         */
        numberedListAction: function() {
            this.toggleLists('ordered-list', 1);
        },

        /**
         * Convert several selected lines to ordered or unordered lists.
         */
        toggleLists: function(type, order) {
            var state = this.getState(),
                start = this.editor.getCursor('start'),
                end   = this.editor.getCursor('end');

            // Convert each line to list
            _.each(new Array(end.line - start.line + 1), function(val, i) {
                this.toggleList(type, start.line + i, state, order);
                if (order) {
                    order++;
                }
            }, this);
        },

        /**
         * Convert selected text to an ordered or unordered list.
         */
        toggleList: function(name, line, state, order) {
            var text = this.editor.getLine(line);

            // If it is a list, convert it to normal text
            if (_.indexOf(state, name) !== -1) {
                text = text.replace(this.marks[name].replace, '$1');
            }
            else if (order) {
                text = order + '. ' + text;
            }
            else {
                text = this.marks[name].tag + text;
            }

            this.replaceRange(text, line);
        },

        /**
         * Redo the last action in Codemirror.
         */
        redoAction: function() {
            this.editor.redo();
        },

        /**
         * Undo the last action in Codemirror.
         */
        undoAction: function() {
            this.editor.undo();
        },

        /**
         * Focus on the editor.
         */
        focus: function() {
            this.editor.focus();
        },

        generateLink: function(data) {
            return '[' + data.text + ']' + '(' + data.url + ')';
        },

        generateImage: function(data) {
            return '!' + this.generateLink(data);
        },

        generateSummary: function(transcription) {
            console.log('generateSummary with transcription: ', transcription);

            // Generate the course title
            var courseTitle = "## 课程笔记\n\n";
            this.editor.replaceSelection(courseTitle);

            axios.post(constants.LLM_API_URL, {
                model: 'qwen-plus',
                messages: [
                        {
                            role: 'user',
                            content: '请你总结一下一段课程的文字, 总结的格式应该是markdown格式; \
                            总结内容要有一个课程标题, 课程标题用###, 然后内容应该以点的形式展示, 每个点之间用换行符隔开; \
                            如果在这段文字中有布置作业的内容, 请把作业内容总结出来, 并放在总结内容的最后一个段落, 作业标题的字号要比课程标题小一级, 如果没有作业, 就在作业内容中写无; \
                            如果在这段文字中有布置课堂练习的内容, 请把课堂练习内容总结出来, 并用单独的课堂练习段落展示, 课堂练习标题的字号要比课程标题小一级; \
                            文字的内容如下: \n' + transcription
                        }
                    ]
                }, { headers: {
                        'Authorization': 'Bearer ' + constants.LLM_API_KEY,
                        'Content-Type': 'application/json'
                    }
            }).then((response) => {
                console.log('generateSummary response: ', response);

                // 从response中提取总结内容
                var summary = response.data.choices[0].message.content;
                console.log('generateSummary summary: \n' + summary);

                // 将总结内容添加到编辑器中
                this.editor.replaceSelection(summary);
            }).catch((error) => {
                console.log('generateSummary error: ', error.response);  
            });
        },
    });

    return Controller;
});
