"""Serve only the standalone art delivery on loopback; no app changes."""
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import unquote,urlsplit
import mimetypes,argparse
HERE=Path(__file__).resolve().parent
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=(HERE/unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if not path.is_relative_to(HERE) or path.suffix.lower() not in {'.html','.mjs','.js','.json','.png','.webp'} or not path.is_file():self.send_error(404);return
        data=path.read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript' if path.suffix in {'.mjs','.js'} else mimetypes.guess_type(path)[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    def log_message(self,*args):pass
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8847);args=parser.parse_args()
    print(f'http://127.0.0.1:{args.port}/preview.html',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
