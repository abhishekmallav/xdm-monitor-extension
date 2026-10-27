// Apply the requested automatic-save default once; later user choices still persist.
export function migrateAutomaticSave(options, storage = localStorage) {
    const key = 'xdm-hls-automatic-save-v1';
    if (storage.getItem(key) !== '1') {
        options.autoSave = true;
        storage.setItem(key, '1');
    }
}
