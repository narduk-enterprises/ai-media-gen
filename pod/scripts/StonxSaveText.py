"""
A simple custom node to save text so it appears in the ComfyUI /history endpoint.
"""

class StonxSaveText:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True}),
            }
        }
    
    RETURN_TYPES = ()
    FUNCTION = "save_text"
    OUTPUT_NODE = True
    CATEGORY = "Stonx"

    def save_text(self, text):
        return {"ui": {"text": [str(text)]}}

NODE_CLASS_MAPPINGS = {
    "StonxSaveText": StonxSaveText
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StonxSaveText": "Save Text (Stonx)"
}
