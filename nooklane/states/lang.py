import reflex as rx

from nooklane.i18n import TEXTS


class LangState(rx.State):
    """The page language (English / 繁體中文), remembered in the browser."""

    lang: str = rx.LocalStorage("", name="nooklane_lang")

    @rx.var
    def ui_lang(self) -> str:
        return self.lang if self.lang in TEXTS else "en"

    @rx.var
    def t(self) -> dict[str, str]:
        return {**TEXTS["en"], **TEXTS.get(self.lang, {})}

    @rx.event
    def init_lang(self):
        """First visit: follow the browser's language."""
        if self.lang in TEXTS:
            return
        accept = (self.router.headers.accept_language or "").lower()
        self.lang = "zh" if accept.startswith("zh") or ",zh" in accept else "en"

    @rx.event
    def toggle_lang(self):
        self.lang = "en" if self.ui_lang == "zh" else "zh"
