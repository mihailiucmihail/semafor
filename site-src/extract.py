import json,sys
from html.parser import HTMLParser
ATTRS={'alt','aria-label','title'}
class P(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=False); s.out=[]; s.skip=0; s.meta=None
    def handle_starttag(s,t,a):
        if t in('script','style'): s.skip+=1
        d=dict(a)
        for k in ATTRS:
            if d.get(k): s.out.append(d[k])
        if t=='meta' and (d.get('name')=='description' or d.get('property') in('og:title','og:description')): s.out.append(d['content'])
    def handle_endtag(s,t):
        if t in('script','style'): s.skip-=1
    def handle_data(s,d):
        if not s.skip and d.strip(): s.out.append(d.strip())
p=P(); p.feed(open(sys.argv[1]).read())
seen=[]; [seen.append(x) for x in p.out if x not in seen]
json.dump(seen,open('strings.en.json','w'),ensure_ascii=False,indent=0)
print(len(seen))
