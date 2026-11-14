import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OrbitAltTabPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const ru = GLib.get_language_names().some(lang => /^ru(?:[_@.-]|$)/i.test(lang));
        const tr = (r, e) => ru ? r : e;
        const page = new Adw.PreferencesPage();
        const group = (r, e, rd = '', ed = '') => {
            const g = new Adw.PreferencesGroup({title: tr(r, e), description: tr(rd, ed)});
            page.add(g);
            return g;
        };
        const cards = group('Карточки и 3D', 'Cards and 3D',
            'Расположение и перспектива карточек.', 'Card layout and perspective.');
        const animations = group('Анимации', 'Animations');
        const reflections = group('Отражения', 'Reflections');
        const captions = group('Иконки и подписи', 'Icons and captions');
        const advanced = group('Дополнительные настройки', 'Additional settings');
        const reset = group('Сброс', 'Reset');

        const addScale = (g, r, e, rd, ed, key, lower, upper, step) => {
            const row = new Adw.ActionRow({title: tr(r, e), subtitle: tr(rd, ed)});
            const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step,
                page_increment: step * 2, value: settings.get_int(key)});
            const scale = new Gtk.Scale({orientation: Gtk.Orientation.HORIZONTAL,
                adjustment, draw_value: true, digits: 0, hexpand: true, width_request: 220});
            scale.connect('value-changed', widget => {
                const value = Math.round(widget.get_value());
                if (settings.get_int(key) !== value)
                    settings.set_int(key, value);
            });
            settings.connect(`changed::${key}`, () => {
                const value = settings.get_int(key);
                if (Math.round(scale.get_value()) !== value)
                    scale.set_value(value);
            });
            row.add_suffix(scale);
            row.set_activatable_widget(scale);
            g.add(row);
        };
        const addSwitch = (g, r, e, rd, ed, key) => {
            const row = new Adw.SwitchRow({title: tr(r, e), subtitle: tr(rd, ed),
                active: settings.get_boolean(key)});
            row.connect('notify::active', widget => {
                if (settings.get_boolean(key) !== widget.active)
                    settings.set_boolean(key, widget.active);
            });
            settings.connect(`changed::${key}`, () => {
                row.active = settings.get_boolean(key);
            });
            g.add(row);
        };
        const addCombo = (g, r, e, rd, ed, key, choices) => {
            const row = new Adw.ComboRow({title: tr(r, e), subtitle: tr(rd, ed)});
            const model = new Gtk.StringList();
            for (const [value, russian, english] of choices)
                model.append(tr(russian, english));
            row.model = model;
            const sync = () => {
                const index = Math.max(0, choices.findIndex(c => c[0] === settings.get_string(key)));
                if (row.selected !== index)
                    row.selected = index;
            };
            sync();
            row.connect('notify::selected', widget => {
                const choice = choices[widget.selected];
                if (choice && settings.get_string(key) !== choice[0])
                    settings.set_string(key, choice[0]);
            });
            settings.connect(`changed::${key}`, sync);
            g.add(row);
        };

        addCombo(cards, 'Стиль карусели', 'Carousel style',
            'Плавный или кинематографичный.', 'Smooth or cinematic.', 'visual-style', [
                ['smooth', 'Плавный', 'Smooth'], ['cinematic', 'Кинематографичный', 'Cinematic']]);
        addSwitch(cards, 'Плоский режим', 'Flat mode',
            'Без 3D-поворотов; расположение и анимации сохраняются.',
            'No 3D rotation; layout and animations are preserved.', 'diagnostic-flat-mode');
        addScale(cards, 'Размер миниатюр', 'Preview size',
            'Масштаб от 50% до 180%.', 'Scale from 50% to 180%.',
            'preview-scale', 50, 180, 5);
        addScale(cards, 'Расстояние между карточками', 'Card spacing',
            'Ближайшие окна раздвигаются; дальние образуют стопки.',
            'Nearby windows spread out; distant windows form stacks.',
            'card-spacing', 120, 420, 5);
        addScale(cards, 'Добавка к углу', 'Extra rotation',
            'Базовые углы: 0°, 3°, 6°, 12°, 24°. Добавка: 0–5°.',
            'Base angles: 0°, 3°, 6°, 12°, 24°. Addition: 0–5°.',
            'rotation-angle', 0, 5, 1);
        addScale(animations, 'Длительность перехода (мс)', 'Transition duration (ms)',
            'Меньше — быстрее; больше — медленнее.', 'Lower is faster; higher is slower.',
            'animation-duration', 100, 600, 20);
        addSwitch(reflections, 'Включить отражения', 'Enable reflections',
            'Плавное затухание книзу.', 'Gradual fade toward the bottom.',
            'reflections-enabled');
        addSwitch(captions, 'Показывать иконку', 'Show app icon',
            'Иконка приложения поверх миниатюры.', 'App icon over the preview.', 'show-icon');
        addSwitch(captions, 'Показывать название', 'Show window title',
            'Название активного окна.', 'Window title.', 'show-text');
        addSwitch(captions, 'Фон подписи', 'Caption background',
            'Затемнённая полоска под иконкой и названием.',
            'Dark strip behind the icon and title.', 'caption-background');
        addCombo(captions, 'Положение иконки', 'Icon position',
            'Расположение поверх миниатюры.', 'Position over the preview.',
            'icon-position', [
                ['top-left', 'Сверху слева', 'Top left'],
                ['top-right', 'Сверху справа', 'Top right'],
                ['bottom-left', 'Снизу слева', 'Bottom left'],
                ['bottom-right', 'Снизу справа', 'Bottom right'],
                ['bottom-center', 'Снизу по центру', 'Bottom center']]);
        addSwitch(advanced, 'Совместимость с Blur my Shell', 'Blur my Shell compatibility',
            'Менее тёмный фон; не управляет размытием.',
            'Lighter backdrop; does not control blur.', 'blur-friendly');
        addSwitch(advanced, 'Автоматический компактный режим', 'Automatic compact mode',
            'Уменьшает карточки при большом количестве окон.',
            'Shrinks cards when many windows are open.', 'compact-enabled');
        addScale(advanced, 'Порог компактного режима (окон)', 'Compact mode threshold (windows)',
            'Количество окон для активации компактного режима.',
            'Number of windows that activates compact mode.',
            'compact-threshold', 3, 30, 1);

        const resetRow = new Adw.ActionRow({
            title: tr('Сбросить настройки', 'Reset settings'),
            subtitle: tr('Вернуть заводские значения.', 'Restore factory defaults.'),
        });
        const resetButton = new Gtk.Button({
            label: tr('Сбросить', 'Reset'), valign: Gtk.Align.CENTER});
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({transient_for: window, modal: true,
                heading: tr('Сбросить настройки?', 'Reset settings?'),
                body: tr('Все параметры, включая сочетания клавиш, будут сброшены.',
                    'All settings, including keyboard shortcuts, will be reset.')});
            dialog.add_response('cancel', tr('Отмена', 'Cancel'));
            dialog.add_response('reset', tr('Сбросить', 'Reset'));
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.connect('response', (_dialog, response) => {
                if (response === 'reset') {
                    for (const key of settings.settings_schema.list_keys())
                        settings.reset(key);
                }
                dialog.close();
            });
            dialog.present();
        });
        resetRow.add_suffix(resetButton);
        resetRow.set_activatable_widget(resetButton);
        reset.add(resetRow);
        window.add(page);
    }
}
