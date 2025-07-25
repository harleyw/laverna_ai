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
    'marionette',
    'backbone.radio',
    'text!modules/codemirror/templates/editor.html'
], function(_, Marionette, Radio, Tmpl) {
    'use strict';

    /**
     * Codemirror view.
     */
    var View = Marionette.ItemView.extend({
        template: _.template(Tmpl),
        className: 'layout--body container-fluid',

        ui: {
            preview       : '#wmd-preview',
            previewScroll : '.editor--preview',
            bar           : '.editor--bar'
        },

        events: {
            'click .editor--btns .btn' : 'triggerAction',
            'click .editor--col--btn'  : 'showColumn'
        },

        initialize: function() {
            this.options.mode = Radio.request('configs', 'get:config', 'editMode');
            this.iconStates = {};

            this.listenTo(this, 'editor:change', this.onEditorChange);
            this.listenTo(this, 'change:mode', this.onChangeMode);
            this.listenTo(Radio.channel('editor'), 'editor:action', (action) => {
                const e = { currentTarget: $(`.editor--btns .btn[data-action="${action}"]`) };
                this.triggerAction(e);
            });

            this.$layoutBody = $('.layout--body.-scroll.-form');
            this.$layoutBody.on('scroll', _.bind(this.onScroll, this));
        },

        onDestroy: function() {
            this.$layoutBody.off('scroll');
            Radio.trigger('editor', 'view:destroy');
        },

        onChangeMode: function(mode) {
            this.options.mode = mode;

            if (mode !== 'normal') {

                // Make the editor visible by scrolling back
                this.$layoutBody.scrollTop(0);

                // Change WYSIWYG bar width
                this.ui.bar.css('width', 'initial');
                return this.ui.bar.removeClass('-fixed');
            }
        },

        onScroll: function() {

            // If editor mode is not 'normal' mode, don't do anything
            if (this.options.mode !== 'normal') {
                return;
            }

            // Fix WYSIWYG bar on top
            if (this.$layoutBody.scrollTop() > this.ui.bar.offset().top) {
                this.ui.bar.css('width', this.$layoutBody.width());
                return this.ui.bar.addClass('-fixed');
            }

            this.ui.bar.css('width', 'initial');
            return this.ui.bar.removeClass('-fixed');
        },

        onEditorChange: function(content) {
            this.ui.preview.html(content);

            if (!this.isFirst) {
                this.isFirst = true;
                return Radio.trigger('editor', 'view:render', this);
            }
            Radio.trigger('editor', 'preview:refresh');
        },

        triggerAction: function(e) {
            if (e && typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
            var $btn = $(e.currentTarget);
            var action = $btn.attr('data-action');
            var $icon = $btn.find('i');
            
            console.log('Step into triggerAction with action ', action);

            // 定义 recordStart 按钮的图标对
            if (action === 'recordStart') {
                this.iconStates[action] = !this.iconStates[action];
                if (this.iconStates[action]) {
                    console.log('recordStart icon is changed to icon-play-circled2');
                    $icon.attr('class', 'icon-play-circled2');
                } else {
                    console.log('recordStart icon is changed to icon-play-circled');
                    $icon.attr('class', 'icon-play-circled');
                }
            }

            if (action && e && typeof e.preventDefault === 'function') {
                this.trigger('editor:action', action);
            }
            console.log('Step out triggerAction with action ', action);
        },

        /**
         * Shows either the preview or the editor.
         */
        showColumn: function(e) {
            var $btn    = $(e.currentTarget),
                col     = $btn.attr('data-col'),
                hideCol = (col === 'left' ? 'right' : 'left');

            // Add 'active' class to the button
            this.$('.editor--col--btn.active').removeClass('active');
            $btn.addClass('active');

            // Show only one column
            this.$('.-' + hideCol).removeClass('-show');
            this.$('.-' + col).addClass('-show');
        },

    });

    return View;
});
