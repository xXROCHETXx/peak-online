import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_host', ROOT / 'scripts' / 'package_host.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class LoaderRoutingTest(unittest.TestCase):
    def test_patched_code_is_local_and_large_original_assets_use_pinned_cdn(self):
        original = '''var MANIFEST = {
  "data": {"file":"data","parts":["data.part000"],"bytes":19},
  "code": {"file":"../experimental/code.wasm?v=1","bytes":0},
  "framework": {"file":"../experimental/framework.js?v=1","bytes":0},
  "loader": {"file":"loader.js","bytes":1}
};
var BUILD = "Build";
var CDN_BASE = new URL(".", window.location.href).href.replace(/\\/$/, "");
var url = BUILD + "/" + urls[i];
script.src = BUILD + "/" + MANIFEST.loader.file;
streamingAssetsUrl: "StreamingAssets",
<script src="experimental/host.js"></script>
// All player files, StreamingAssets and LevelBundles are served from here.
'''
        scratch = ROOT / 'artifacts'
        scratch.mkdir(exist_ok=True)
        # Keep fixture files and automatic cleanup inside this checkout.
        with tempfile.TemporaryDirectory(dir=scratch) as temporary:
            root = Path(temporary)
            self.assertTrue(root.resolve().is_relative_to(scratch.resolve()))
            (root / 'experimental').mkdir()
            (root / 'experimental' / 'code.wasm').write_bytes(b'wasm')
            (root / 'experimental' / 'framework.js').write_bytes(b'framework')
            result = module.cdn_entry(original, root)
        manifest = json.loads(re.search(r'var MANIFEST = (\{.*?\n\});', result, re.S)[1])
        self.assertEqual(manifest['code']['bytes'], 4)
        self.assertEqual(manifest['framework']['bytes'], 9)
        self.assertTrue(manifest['code']['local'])
        self.assertNotIn('local', manifest['data'])
        self.assertEqual(urljoin('https://host.example/Build/', manifest['code']['file']), 'https://host.example/experimental/code.wasm?v=1')
        self.assertEqual(urljoin(module.CDN + '/Build/', manifest['data']['parts'][0]), module.CDN + '/Build/data.part000')
        self.assertIn('streamingAssetsUrl: CDN_BASE + "/StreamingAssets"', result)
        self.assertIn('experimental/host-share.js', result)

    def test_changed_input_fails_instead_of_silently_publishing_a_broken_loader(self):
        with self.assertRaises(ValueError): module.cdn_entry('<html>unknown loader</html>', ROOT)

    def test_pages_does_not_publish_backend_and_frame_delegates_mic(self):
        workflow = (ROOT / '.github' / 'workflows' / 'pages.yml').read_text(encoding='utf-8')
        self.assertIn('path: site', workflow)
        app = (ROOT / 'site' / 'app.mjs').read_text(encoding='utf-8')
        self.assertIn("frame.allow = 'microphone; fullscreen; autoplay; clipboard-write'", app)
        self.assertNotIn('const defaultServer', app)

if __name__ == '__main__': unittest.main()
