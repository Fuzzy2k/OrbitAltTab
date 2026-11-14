import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SUPER_FORWARD = 'activate-switcher';
const SUPER_BACKWARD = 'activate-switcher-backward';
const ALT_BINDINGS = [
    'switch-applications',
    'switch-applications-backward',
    'switch-windows',
    'switch-windows-backward',
];

const BASE_CARD_WIDTH = 380;
const BASE_PREVIEW_HEIGHT = 230;
const BASE_CARD_HEIGHT = 300;
const COMPACT_CARD_WIDTH = 300;
const COMPACT_PREVIEW_HEIGHT = 155;
const COMPACT_CARD_HEIGHT = 220;
const VISIBLE_RADIUS = 4;

class OrbitSwitcher {
    constructor(settings) {
        this._settings = settings;
        this._windows = [];
        this._selectedIndex = 0;
        this._overlay = null;
        this._keyController = null;
        this._modal = null;
        this._cards = [];
        this._modifier = null;
        this._closing = false;
        this._compact = false;
        this._motionSerial = 0;
        this._lastDirection = 1;
    }

    show(direction = 1, modifier = 'alt') {
        if (this._overlay) {
            this._modifier = modifier;
            this._move(direction);
            return;
        }

        // NORMAL_ALL includes windows from every workspace. Do not scope
        // the list to the active workspace: Cover Flow is global.
        this._windows = global.display
            .get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(window => {
                try {
                    return !window.is_skip_taskbar() && Boolean(window.get_title());
                } catch (error) {
                    return false;
                }
            });

        if (this._windows.length === 0)
            return;

        this._compact = this._settings.get_boolean('compact-enabled') &&
            this._windows.length >= this._settings.get_int('compact-threshold');

        const focused = global.display.focus_window;
        const focusedIndex = this._windows.indexOf(focused);
        const baseIndex = focusedIndex >= 0 ? focusedIndex : 0;
        this._selectedIndex = (baseIndex + direction + this._windows.length) % this._windows.length;
        this._modifier = modifier;
        this._lastDirection = direction >= 0 ? 1 : -1;
        this._closing = false;

        this._overlay = new St.Widget({
            style_class: this._settings.get_boolean('blur-friendly') ? 'orbit-overlay orbit-overlay-blur-friendly' : 'orbit-overlay',
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        Main.layoutManager.addChrome(this._overlay, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._keyController = new Clutter.KeyController();
        this._keyController.connect('key-press', controller => {
            const [valid, keyval] = controller.get_key();
            if (!valid)
                return Clutter.EVENT_PROPAGATE;

            if (keyval === Clutter.KEY_Left || keyval === Clutter.KEY_h) {
                this._move(-1);
                return Clutter.EVENT_STOP;
            }
            if (keyval === Clutter.KEY_Right || keyval === Clutter.KEY_l || keyval === Clutter.KEY_Tab) {
                const [, state] = controller.get_state();
                this._move((state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1);
                return Clutter.EVENT_STOP;
            }
            if (keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter || keyval === Clutter.KEY_space) {
                this._activateSelected();
                return Clutter.EVENT_STOP;
            }
            if (keyval === Clutter.KEY_Escape) {
                this.hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._keyController.connect('key-release', controller => {
            const [valid, keyval] = controller.get_key();
            if (!valid)
                return Clutter.EVENT_PROPAGATE;

            const releasedAlt = keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R;
            const releasedSuper = keyval === Clutter.KEY_Super_L || keyval === Clutter.KEY_Super_R;
            if ((this._modifier === 'alt' && releasedAlt) ||
                (this._modifier === 'super' && releasedSuper)) {
                this._activateSelected();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._overlay.add_action(this._keyController);
        this._modal = Main.pushModal(this._overlay);
        if (!this._modal) {
            this._destroyOverlay();
            this._windows = [];
            return;
        }
        this._overlay.grab_key_focus();
        this._rebuildCards(true);
    }

    _getPrimaryMonitor() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor)
            return monitor;
        return {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
    }

    _getDimensions() {
        const scale = this._settings.get_int('preview-scale') / 100;
        const compact = this._compact;
        const baseWidth = compact ? COMPACT_CARD_WIDTH : BASE_CARD_WIDTH;
        const basePreviewHeight = compact ? COMPACT_PREVIEW_HEIGHT : BASE_PREVIEW_HEIGHT;
        const baseHeight = compact ? COMPACT_CARD_HEIGHT : BASE_CARD_HEIGHT;
        return {
            scale,
            width: Math.round(baseWidth * scale),
            previewHeight: Math.round(basePreviewHeight * scale),
            height: Math.round(baseHeight * scale),
            padding: Math.max(8, Math.round(10 * scale)),
        };
    }

    _getTarget(offset) {
        const monitor = this._getPrimaryMonitor();
        const {scale, width, height} = this._getDimensions();
        const centerX = monitor.x + monitor.width / 2;
        const centerY = monitor.y + monitor.height / 2;
        const cinematic = this._settings.get_string('visual-style') === 'cinematic';
        const depth = Math.abs(offset);
        // iPod-style Cover Flow: the nearest card has a clear gap from the
        // selected card, while distant cards form progressively tighter stacks.
        // Map the FULL GSettings slider range onto a fraction of the monitor's
        // usable half-width. Unlike a hard min/max cap, this stays responsive
        // even with nine windows on a narrow monitor.
        const spacingValue = this._settings.get_int('card-spacing');
        const spacingFraction = Math.max(0, Math.min(1,
            (spacingValue - 120) / (420 - 120)));
        const available = Math.max(0, monitor.width / 2 - width * 0.25 - 24 * scale);
        const firstStep = available * (0.24 + 0.27 * spacingFraction);
        const stackOffsets = [0, 1, 1.34, 1.56, 1.70];
        const horizontal = firstStep * stackOffsets[Math.min(depth, VISIBLE_RADIUS)];
        const sideScale = cinematic ? [1, 0.72, 0.54, 0.46, 0.40] : [1, 0.82, 0.68, 0.58, 0.50];
        const sideOpacity = cinematic ? [255, 222, 185, 160, 138] : [255, 238, 216, 195, 175];
        const flatDiagnostic = this._settings.get_boolean('diagnostic-flat-mode');
        // Fixed, symmetric base angles per distance from the selected window.
        // The slider adds 0..5 degrees to EVERY side card, not per level.
        const baseAngles = [0, 3, 6, 12, 24];
        const angleAddition = this._settings.get_int('rotation-angle');
        const magnitude = flatDiagnostic || depth === 0 ? 0 :
            baseAngles[Math.min(depth, VISIBLE_RADIUS)] + angleAddition;
        return {
            x: centerX - width / 2 + Math.sign(offset) * horizontal,
            y: centerY - height / 2 + depth * (cinematic ? 18 : 9) * scale,
            scale: sideScale[depth],
            opacity: sideOpacity[depth],
            // Exact mirror angles for left/right at the same depth.
            angle: -Math.sign(offset) * magnitude,
        };
    }

    _visibleEntries() {
        // Build offsets from distinct window indices, not by walking -2..+2
        // and deduplicating. That old algorithm placed a single window at -2
        // (invisible / nearly transparent) and two windows only on the left.
        const count = this._windows.length;
        const entries = [{index: this._selectedIndex, offset: 0}];
        if (count <= 1)
            return entries;

        const radius = Math.min(VISIBLE_RADIUS, Math.floor(count / 2));
        for (let distance = 1; distance <= radius; distance++) {
            const left = (this._selectedIndex - distance + count) % count;
            const right = (this._selectedIndex + distance) % count;
            if (left === right) {
                // For even counts, the opposite card has no natural side.
                // Prefer the side we're navigating towards.
                entries.push({index: left, offset: this._lastDirection * distance});
            } else {
                entries.push({index: left, offset: -distance});
                entries.push({index: right, offset: distance});
            }
        }
        return entries;
    }

    _createIcon(window) {
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(window);
            return app?.create_icon_texture(this._compact ? 24 : 32) ?? null;
        } catch (error) {
            console.debug(`OrbitAltTab: app icon unavailable: ${error.message}`);
            return null;
        }
    }

    _createPreview(window, width, height) {
        const frame = new St.Widget({
            style_class: 'orbit-preview-frame',
            width,
            height,
            clip_to_allocation: true,
            reactive: false,
        });

        // Clone the compositor's already-rendered window. A single uniform
        // scale is applied to its native size: neither axis is stretched.
        // The frame stays the same size, so card positions and animation
        // (including the verified keyboard recovery logic) remain unchanged.
        try {
            const source = window.get_compositor_private();
            if (source && !source.is_destroyed?.()) {
                const [actorWidth, actorHeight] = source.get_size();
                const rect = window.get_frame_rect();
                const sourceWidth = actorWidth > 0 ? actorWidth : rect.width;
                const sourceHeight = actorHeight > 0 ? actorHeight : rect.height;
                if (sourceWidth > 0 && sourceHeight > 0) {
                    const factor = Math.min(width / sourceWidth, height / sourceHeight);
                    const targetWidth = Math.max(1, Math.round(sourceWidth * factor));
                    const targetHeight = Math.max(1, Math.round(sourceHeight * factor));
                    const clone = new Clutter.Clone({source, reactive: false});
                    clone.set_size(targetWidth, targetHeight);
                    clone.set_position(
                        Math.round((width - targetWidth) / 2),
                        Math.round((height - targetHeight) / 2));
                    frame.add_child(clone);
                    return frame;
                }
            }
        } catch (error) {
            console.debug(`OrbitAltTab: compositor clone fallback: ${error.message}`);
        }

        // Keep the previously working GNOME preview implementation as a
        // fallback for windows whose compositor actor is not ready yet.
        let sourceWidth = width;
        let sourceHeight = height;
        try {
            const rect = window.get_frame_rect();
            if (rect.width > 0 && rect.height > 0) {
                const fit = Math.min(width / rect.width, height / rect.height);
                sourceWidth = Math.max(1, Math.round(rect.width * fit));
                sourceHeight = Math.max(1, Math.round(rect.height * fit));
            }
        } catch (error) {
            console.debug(`OrbitAltTab: could not read window dimensions: ${error.message}`);
        }
        const layout = new Shell.WindowPreviewLayout();
        const preview = new St.Widget({
            style_class: 'orbit-preview',
            width: sourceWidth,
            height: sourceHeight,
            layout_manager: layout,
            clip_to_allocation: true,
        });
        preview.set_position(Math.round((width - sourceWidth) / 2),
            Math.round((height - sourceHeight) / 2));
        frame.add_child(preview);
        let previewCreated = false;
        try {
            const previewActor = layout.add_window(window);
            if (previewActor) {
                previewCreated = true;
                previewActor.set_reactive(false);
            }
        } catch (error) {
            console.debug(`OrbitAltTab: preview unavailable: ${error.message}`);
        }
        if (!previewCreated) {
            preview.add_child(new St.Label({
                text: 'Preview unavailable',
                style_class: 'orbit-preview-placeholder',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        return frame;
    }

    _createMetadata(window, frame, width, height) {
        const showIcon = this._settings.get_boolean('show-icon');
        const showText = this._settings.get_boolean('show-text');
        if (!showIcon && !showText)
            return;

        const position = this._settings.get_string('icon-position');
        const icon = showIcon ? this._createIcon(window) : null;
        let title = window.get_title() || '';
        if (!title) {
            try {
                title = Shell.WindowTracker.get_default().get_window_app(window)?.get_name() ?? 'Window';
            } catch (error) {
                title = 'Window';
            }
        }
        const label = showText ? new St.Label({
            text: title,
            style_class: 'orbit-card-title',
            y_align: Clutter.ActorAlign.CENTER,
        }) : null;
        const row = new St.BoxLayout({
            style_class: this._settings.get_boolean('caption-background')
                ? 'orbit-metadata-overlay' : 'orbit-metadata-overlay orbit-metadata-no-background',
            orientation: Clutter.Orientation.HORIZONTAL,
            reactive: false,
        });
        // In right corners the title sits to the left of the icon.
        const right = position.endsWith('right');
        if (right && label)
            row.add_child(label);
        if (icon) {
            icon.add_style_class_name('orbit-app-icon');
            row.add_child(icon);
        }
        if (!right && label)
            row.add_child(label);
        if (!row.get_n_children())
            return;

        frame.add_child(row);
        // Overlay positioning uses fixed card bounds, not the reflection area.
        row.set_size(Math.min(width - 16, showText ? width * 0.75 : 48), this._compact ? 34 : 42);
        const x = right ? width - row.width - 8
            : position === 'bottom-center' ? (width - row.width) / 2 : 8;
        const y = position.startsWith('top') ? 8 : height - row.height - 8;
        row.set_position(Math.round(x), Math.round(y));
    }

    _makeCard(index) {
        const window = this._windows[index];
        const {width, previewHeight, height, padding} = this._getDimensions();
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: `orbit-card${this._compact ? ' orbit-card-compact' : ''}`,
            width,
            height,
            reactive: false,
        });
        card.set_pivot_point(0.5, 0.5);
        const pw = width - padding * 2;
        const preview = this._createPreview(window, pw, previewHeight);
        // Keep metadata in a sibling overlay, not inside the actor cloned
        // for reflection. The clone must contain window pixels only.
        const previewSurface = new St.Widget({
            width: pw,
            height: previewHeight,
            reactive: false,
            clip_to_allocation: true,
        });
        previewSurface.add_child(preview);
        card.add_child(previewSurface);
        // Keep the existing reflection geometry, but fade it smoothly toward
        // the bottom using clipped strips. This avoids a custom shader and
        // does not change the carousel's movement or card transforms.
        if (this._settings.get_boolean('reflections-enabled')) {
            const reflectionHeight = Math.max(1, Math.round(previewHeight * 0.20));
            const reflection = new St.Widget({
                width: pw,
                height: reflectionHeight,
                reactive: false,
                clip_to_allocation: true,
            });
            const strips = Math.min(12, reflectionHeight);
            for (let i = 0; i < strips; i++) {
                const start = Math.floor(i * reflectionHeight / strips);
                const end = Math.floor((i + 1) * reflectionHeight / strips);
                const strip = new St.Widget({
                    width: pw,
                    height: end - start,
                    y: start,
                    reactive: false,
                    clip_to_allocation: true,
                    // The top is visible and the bottom gently disappears.
                    opacity: Math.round(76 * Math.pow(1 - (i + 0.5) / strips, 1.6)),
                });
                const reflected = new Clutter.Clone({source: preview, reactive: false});
                reflected.set_size(pw, previewHeight);
                reflected.set_pivot_point(0, 0);
                reflected.set_scale(1, -1);
                reflected.set_position(0, previewHeight - start);
                strip.add_child(reflected);
                reflection.add_child(strip);
            }
            card.add_child(reflection);
        }
        this._createMetadata(window, previewSurface, pw, previewHeight);
        card.set_pivot_point(0.5, 0.5);
        this._overlay.add_child(card);
        return {actor: card, index, offset: 0};
    }

    _rebuildCards(animateEntrance = false, moveDelta = 0) {
        if (!this._overlay)
            return;
        const entries = this._visibleEntries();
        const visible = new Set(entries.map(entry => entry.index));
        const previous = new Map(this._cards.map(card => [card.index, card]));
        const next = [];
        const duration = this._settings.get_int('animation-duration');
        const reducedMotion = St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE;
        const animate = !reducedMotion && duration > 0;
        ++this._motionSerial;
        for (const {index, offset} of entries) {
            let item = previous.get(index);
            if (!item) {
                item = this._makeCard(index);
                const target = this._getTarget(offset);
                const origin = this._getTarget(Math.max(-VISIBLE_RADIUS, Math.min(VISIBLE_RADIUS,
                    animateEntrance ? 0 : offset + Math.sign(moveDelta || 1))));
                item.actor.set_position(origin.x, origin.y);
                item.actor.set_scale(origin.scale * 0.86, origin.scale * 0.86);
                item.actor.rotation_angle_y = origin.angle;
                item.actor.opacity = animate ? 0 : target.opacity;
            }
            item.offset = offset;
            next.push(item);
        }
        // Remove outgoing actors immediately. Their delayed exit animations could
        // cover the selected preview during rapid navigation, especially on wrap.
        // Persistent visible actors still animate smoothly between positions.
        for (const old of this._cards) {
            if (visible.has(old.index))
                continue;
            old.actor.remove_all_transitions();
            old.actor.destroy();
        }
        this._cards = next;
        // Back-to-front order: outer cards first, selected preview last.
        for (const item of [...next].sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset)))
            this._overlay.set_child_above_sibling(item.actor, null);
        for (const item of next) {
            const target = this._getTarget(item.offset);
            item.actor.remove_all_transitions();
            if (animate) {
                item.actor.ease({
                    x: target.x,
                    y: target.y,
                    scale_x: target.scale,
                    scale_y: target.scale,
                    rotation_angle_y: target.angle,
                    opacity: target.opacity,
                    duration: Math.max(240, duration) *
                        (this._settings.get_string('visual-style') === 'cinematic' ? 1.12 : 1),
                    mode: this._settings.get_string('visual-style') === 'cinematic'
                        ? Clutter.AnimationMode.EASE_OUT_QUINT
                        : Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } else {
                item.actor.set_position(target.x, target.y);
                item.actor.set_scale(target.scale, target.scale);
                item.actor.rotation_angle_y = target.angle;
                item.actor.opacity = target.opacity;
            }
        }
    }

    _move(delta) {
        if (!this._windows.length || !this._overlay || this._closing)
            return;
        this._lastDirection = delta >= 0 ? 1 : -1;
        this._selectedIndex = (this._selectedIndex + delta + this._windows.length) % this._windows.length;
        this._rebuildCards(false, delta);
    }

    _activateSelected() {
        if (this._closing || !this._windows.length)
            return;
        this._closing = true;
        const window = this._windows[this._selectedIndex];
        // Capture the timestamp while handling the user's key event, before
        // the closing animation runs. GNOME uses it to authorize focus.
        const timestamp = global.get_current_time();
        this._closeOverlay(true, () => {
            if (window) {
                try {
                    // Unlike Meta.Window.activate(), Main.activateWindow()
                    // handles switching to the window's workspace as well.
                    Main.activateWindow(window, timestamp);
                } catch (error) {
                    console.warn(`OrbitAltTab: could not activate selected window: ${error.message}`);
                }
            }
        });
    }

    _closeOverlay(animate = true, callback = null) {
        const overlay = this._overlay;
        if (!overlay)
            return;
        const reducedMotion = St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE;
        const duration = this._settings.get_int('animation-duration');
        if (animate && !reducedMotion && duration > 0) {
            overlay.ease({
                opacity: 0,
                duration: Math.min(180, duration),
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    this._destroyOverlay();
                    this._clearState();
                    callback?.();
                },
            });
        } else {
            this._destroyOverlay();
            this._clearState();
            callback?.();
        }
    }

    _clearState() {
        this._keyController = null;
        this._cards = [];
        this._windows = [];
        this._modifier = null;
        this._closing = false;
    }

    _destroyOverlay() {
        const overlay = this._overlay;
        if (!overlay)
            return;
        this._overlay = null;
        if (this._modal) {
            try {
                Main.popModal(overlay);
            } catch (error) {
                console.debug(`OrbitAltTab: modal cleanup: ${error.message}`);
            }
            this._modal = null;
        }
        try {
            Main.layoutManager.removeChrome(overlay);
            overlay.destroy();
        } catch (error) {
            console.debug(`OrbitAltTab: overlay cleanup: ${error.message}`);
        }
    }

    hide() {
        if (!this._overlay)
            return;
        this._closing = true;
        this._closeOverlay(true);
    }

    destroy() {
        // Disabling the extension must not leave an animation callback/modal behind.
        this._closeOverlay(false);
        this._clearState();
        this._settings = null;
    }
}

export default class OrbitAltTabExtension extends Extension {
    enable() {
        this._installedAltBindings = [];
        this._installedSuperBindings = [];
        this._settings = this.getSettings();
        this._switcher = new OrbitSwitcher(this._settings);

        try {
            Main.wm.addKeybinding(
                SUPER_FORWARD,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._safeShow(1, 'super')
            );
            this._installedSuperBindings.push(SUPER_FORWARD);
            Main.wm.addKeybinding(
                SUPER_BACKWARD,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._safeShow(-1, 'super')
            );
            this._installedSuperBindings.push(SUPER_BACKWARD);

            const forwardHandler = () => this._safeShow(1, 'alt');
            const backwardHandler = () => this._safeShow(-1, 'alt');
            for (const name of ALT_BINDINGS) {
                const handler = name.endsWith('backward') ? backwardHandler : forwardHandler;
                Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, handler);
                this._installedAltBindings.push(name);
            }
        } catch (error) {
            this._restoreBindings();
            this._switcher?.destroy();
            this._switcher = null;
            this._settings = null;
            throw error;
        }
    }

    _restoreBindings() {
        // GNOME Shell installs its stock switcher using _startSwitcher.
        // Passing null to setCustomKeybindingHandler does NOT reinstall it.
        // Use the same Shell entry point and bind Main.wm as the receiver.
        for (const name of this._installedAltBindings ?? []) {
            try {
                if (typeof Main.wm._startSwitcher === 'function') {
                    Main.wm.setCustomKeybindingHandler(
                        name,
                        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                        Main.wm._startSwitcher.bind(Main.wm)
                    );
                } else {
                    console.error('OrbitAltTab: GNOME stock _startSwitcher unavailable; ' +
                        `cannot safely restore ${name}`);
                }
            } catch (error) {
                console.error(`OrbitAltTab: failed to restore ${name}: ${error.message}`);
            }
        }
        this._installedAltBindings = [];
        for (const name of this._installedSuperBindings ?? []) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (error) {
                console.error(`OrbitAltTab: failed to remove ${name}: ${error.message}`);
            }
        }
        this._installedSuperBindings = [];
    }

    _safeShow(direction, modifier) {
        try {
            this._switcher?.show(direction, modifier);
        } catch (error) {
            console.error(`OrbitAltTab: switcher failed: ${error.message}`);
            try {
                this._switcher?.destroy();
            } catch (cleanupError) {
                console.error(`OrbitAltTab: cleanup failed: ${cleanupError.message}`);
            }
            // A fresh instance lets the user retry without a stuck modal.
            this._switcher = new OrbitSwitcher(this._settings);
        }
    }

    disable() {
        // Close the modal before returning ownership of the shortcuts.
        try {
            this._switcher?.destroy();
        } catch (error) {
            console.error(`OrbitAltTab: switcher teardown failed: ${error.message}`);
        } finally {
            this._restoreBindings();
            this._switcher = null;
            this._settings = null;
        }
    }
}
