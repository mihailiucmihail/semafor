import json,sys
from html.parser import HTMLParser
EN=set(json.load(open('strings.en.json')))
OK={'Kastel Labs','Semafor','Basic','Pro','1','0','6','3','−','+','I','II','III','#1204','#1205','#1206','mihailiuc.co@gmail.com','COD Fraud','Recovery','Contact','Chargeback','Apps'}
class P(HTMLParser):
    def __init__(s): super().__init__(); s.t=[]; s.k=0
    def handle_starttag(s,t,a):
        if t in('script','style'): s.k+=1
    def handle_endtag(s,t):
        if t in('script','style'): s.k-=1
    def handle_data(s,d):
        if not s.k and d.strip(): s.t.append(d.strip())
for l in ['ro','es','fr','pl','ru']:
    p=P(); p.feed(open(f'../kastellabs/{l}/index.html').read())
    left=[x for x in p.t if x in EN and x not in OK]
    print(l, left)
