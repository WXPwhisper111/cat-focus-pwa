"""Local-only preview server; serves only this preview and its public image assets."""
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlsplit,unquote
import mimetypes
ROOT=Path(__file__).resolve().parents[2]
PREFIX='/art/cat-expansion-v2/'
EXACT={PREFIX+n for n in ('preview.html','preview.js','preview-data.js','gallery.html','motion-reel.webp')}
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  name=unquote(urlsplit(self.path).path)
  path=(ROOT/name.lstrip('/')).resolve()
  if not path.is_relative_to(ROOT):self.send_error(404);return
  canonical='/'+path.relative_to(ROOT).as_posix()
  allowed=canonical in EXACT or (path.suffix.lower() in ('.png','.webp','.json') and any(canonical.startswith(p) for p in ('/art/cat-expansion-v2/resources/','/public/room/','/art/cat-expansion-v1/previews/',PREFIX+'card-previews/',PREFIX+'room-previews/')))
  if not allowed or not path.is_file():self.send_error(404);return
  content=path.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(path)[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(content)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(content)
 def log_message(self,*args):pass
if __name__=='__main__':
 print('http://127.0.0.1:8846/art/cat-expansion-v2/preview.html',flush=True)
 ThreadingHTTPServer(('127.0.0.1',8846),Handler).serve_forever()
