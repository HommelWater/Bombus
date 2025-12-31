from . import database
from fastapi import HTTPException
from google import genai
from google.genai import types
import base64
import tantivy
import json
import time
import hashlib
import os

class TantivySearchIndex:
    def __init__(self, index_path="tantivy_index"):
        # Define schema
        schema_builder = tantivy.SchemaBuilder()
        schema_builder.add_text_field("title", stored=True)
        schema_builder.add_text_field("description", stored=True)
        schema_builder.add_text_field("direct_keywords", stored=True)
        schema_builder.add_text_field("related_keywords", stored=True)
        schema_builder.add_text_field("url", stored=True, tokenizer_name="raw")
        schema_builder.add_unsigned_field("timestamp", stored=True, indexed=True)
        schema_builder.add_unsigned_field("id", stored=True, indexed=False)
        schema_builder.add_unsigned_field("user_id", stored=True, indexed=False)
        self.schema = schema_builder.build()
        os.makedirs(index_path, exist_ok=True)
        self.index = tantivy.Index(self.schema, path=index_path)
        #self.index.tokenizers().register("en_stem", tantivy.tokenizer("en_stem"))
        self.searcher = self.index.searcher()
        self.recently_indexed_cache = []
        self.cache_ptr = 0
        self.cache_size = 15
    
    def add_index(self, info):
        writer = self.index.writer()
        doc = tantivy.Document.from_dict(info)
        writer.add_document(doc)
        self.recently_indexed_cache[self.cache_ptr % self.cache_size] = info
        self.cache_ptr+=1
        
        writer.commit()
        writer.wait_merging_threads()
        self.index.reload()
    
    def search(self, query: str, top_k=10):
        q = self.index.parse_query(
            query, ["title", "description", "direct_keywords", "related_keywords", "timestamp"]
        )
        
        hits = self.searcher.search(q, top_k).hits
        
        results = []
        for score, doc_addr in hits:
            doc = self.searcher.doc(doc_addr)
            results.append({
                'score': score,
                'doc': doc.to_dict()
            })
        return {"search_results":results}


client = genai.Client()
ttv = TantivySearchIndex()
async def index_webpage(session_token, url, title, image_base64_png):
    session = await database.get_session(session_token)
    if not session:
        raise HTTPException(status_code=404, detail="unknown session token")
    sender_user_id = session["user_id"]
    
    prompt = f"""
    Analyze this webpage screenshot from {url}.
    
    Page Title: {title}
    
    Extract:
    1. Important keywords directly on the page.
    2. Important keywords relevant to the page.
    3. A short description of the page.
    4. A fitting title for the page.
    
    Format as structured data.
    """
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash", 
            contents=[
                types.Part.from_bytes(
                    data=base64.b64decode(image_base64_png),
                    mime_type='image/png',
                ),
                prompt
            ],
            config=types.GenerateContentConfig(
                temperature=0.3,
                response_mime_type="application/json",
                response_schema={
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING"},
                        "direct_keywords": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "related_keywords": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "description": {"type": "STRING"}
                    }
                }
            )
        )
    except Exception as e:
        print(f"API Error: {e}", flush=True)
        raise HTTPException(500, f"Gemini API Error: {e}")
    
    try:
        result_data = json.loads(response.text)
    except json.JSONDecodeError as e:
        print(f"JSON Parse Error: {e}, Response: {response.text}", flush=True)
        raise HTTPException(500, f"Failed to parse Gemini response: {e}")
    
    info = {
            'title': result_data.get('title', title),
            'description': result_data.get('description', ''),
            'direct_keywords': ' '.join(result_data.get('direct_keywords', [])),
            'related_keywords': ' '.join(result_data.get('related_keywords', [])),
            'url': url,
            'timestamp': time.time_ns(),
            'user_id': sender_user_id,
            'id':int(hashlib.sha256(url.encode()).hexdigest()[:16], 16) % (2**64)
        }
    ttv.add_index(info)
    
    
async def search(session_token, query):
    session = await database.get_session(session_token)
    if not session:
        raise HTTPException(status_code=404, detail="unknown session token")
    return ttv.search(query, 15)

async def recently_indexed(session_token):
    session = await database.get_session(session_token)
    if not session:
        raise HTTPException(status_code=404, detail="unknown session token")
    return {"recently_indexed": ttv.recently_indexed_cache}