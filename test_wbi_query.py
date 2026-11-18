import urllib.request, json, time, hashlib

def get_wbi_keys():
    url = "https://api.bilibili.com/x/web-interface/nav"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://search.bilibili.com/video?keyword=c%E5%90%9B'
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        wbi_img = data.get('data', {}).get('wbi_img', {})
        img_url = wbi_img.get('img_url', '')
        sub_url = wbi_img.get('sub_url', '')
        img_key = img_url.rsplit('/', 1)[1].split('.')[0]
        sub_key = sub_url.rsplit('/', 1)[1].split('.')[0]
        return img_key, sub_key

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]

def get_mixin_key(orig):
    return ''.join([orig[i] for i in MIXIN_KEY_ENC_TAB])[:32]

def sign(params, img_key, sub_key):
    mixin_key = get_mixin_key(img_key + sub_key)
    curr_time = int(time.time())
    params['wts'] = curr_time
    sorted_params = sorted(params.items())
    query = '&'.join([f"{k}={v}" for k, v in sorted_params])
    w_rid = hashlib.md5((query + mixin_key).encode('utf-8')).hexdigest()
    params['w_rid'] = w_rid
    return '&'.join([f"{k}={urllib.parse.quote(str(v))}" for k, v in sorted_params])

try:
    img_key, sub_key = get_wbi_keys()
    print('Keys:', img_key, sub_key)
    
    import urllib.parse
    params = {
        'keyword': 'c君',
        'search_type': 'video',
        'order': 'totalrank',
        'page': 1
    }
    qs = sign(params, img_key, sub_key)
    url = f"https://api.bilibili.com/x/web-interface/wbi/search/type?{qs}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://search.bilibili.com/video?keyword=c%E5%90%9B'
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        print('Code:', res.get('code'))
        print('Message:', res.get('message'))
        print('numResults:', res.get('data', {}).get('numResults'))
        result = res.get('data', {}).get('result', [])
        print('Result type:', type(result), 'length:', len(result) if result else 0)
        if isinstance(result, list) and len(result) > 0:
            for v in result[:3]:
                print('Item:', v.get('title'), 'Tag:', v.get('tag'), 'Author:', v.get('author'))
except Exception as e:
    import traceback
    traceback.print_exc()
