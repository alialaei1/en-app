from django import forms
from django.core.exceptions import ValidationError

from accounts.limits import (
    apply_char_limit,
    defaults_snapshot,
    get_limits_for_user,
    validate_file_size,
    validate_text_length,
)

from .models import ChunkHighlight, Course, CourseReview, Lesson, LessonChunk, Section, TempUpload


INPUT = (
    "w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 "
    "text-slate-100 placeholder:text-slate-500 outline-none "
    "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
)
TEXTAREA = INPUT + " min-h-28 resize-y"
FILE = (
    "block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg "
    "file:border-0 file:bg-emerald-500 file:px-4 file:py-2 file:font-semibold "
    "file:text-slate-950 hover:file:bg-emerald-400"
)


class CourseForm(forms.ModelForm):
    class Meta:
        model = Course
        fields = ["title", "description", "image", "visibility", "content_kind"]
        labels = {
            "visibility": "Visibility",
            "content_kind": "Content type",
        }
        help_texts = {
            "visibility": "Public courses appear in Explore with your name. Private courses stay in Created.",
            "content_kind": "Helps learners find this course in Explore filters.",
        }
        widgets = {
            "title": forms.TextInput(attrs={"class": INPUT, "placeholder": "Course title"}),
            "description": forms.Textarea(
                attrs={"class": TEXTAREA, "placeholder": "Short description", "rows": 4}
            ),
            "image": forms.ClearableFileInput(
                attrs={
                    "class": FILE,
                    "accept": "image/*",
                    "data-image-crop": "1",
                    "data-crop-aspect": "1.3333",
                    "data-crop-max": "1600",
                    "data-crop-quality": "0.85",
                }
            ),
            "visibility": forms.Select(attrs={"class": INPUT}),
            "content_kind": forms.Select(attrs={"class": INPUT}),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        apply_char_limit(self.fields["title"], self.limits.course_title_max, model_cap=200)
        apply_char_limit(
            self.fields["description"],
            self.limits.course_description_max,
        )

    def clean_title(self):
        return validate_text_length(
            self.cleaned_data.get("title") or "",
            self.limits.course_title_max,
            "Title",
            lang=self.lang,
        )

    def clean_description(self):
        return validate_text_length(
            self.cleaned_data.get("description") or "",
            self.limits.course_description_max,
            "Description",
            lang=self.lang,
        )

    def clean_image(self):
        image = self.cleaned_data.get("image")
        if image and hasattr(image, "size"):
            validate_file_size(image, self.limits.image_max_bytes, "Image", lang=self.lang)
        return image


class SectionForm(forms.ModelForm):
    class Meta:
        model = Section
        fields = ["title", "description"]
        widgets = {
            "title": forms.TextInput(attrs={"class": INPUT, "placeholder": "Section title"}),
            "description": forms.Textarea(
                attrs={"class": TEXTAREA, "placeholder": "Optional notes", "rows": 3}
            ),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        apply_char_limit(self.fields["title"], self.limits.section_title_max, model_cap=200)
        apply_char_limit(self.fields["description"], self.limits.section_description_max)

    def clean_title(self):
        return validate_text_length(
            self.cleaned_data.get("title") or "",
            self.limits.section_title_max,
            "Title",
            lang=self.lang,
        )

    def clean_description(self):
        return validate_text_length(
            self.cleaned_data.get("description") or "",
            self.limits.section_description_max,
            "Description",
            lang=self.lang,
        )


class LessonForm(forms.ModelForm):
    media_temp_id = forms.CharField(required=False, widget=forms.HiddenInput(attrs={"id": "id_media_temp_id"}))
    document_temp_id = forms.CharField(
        required=False, widget=forms.HiddenInput(attrs={"id": "id_document_temp_id"})
    )

    class Meta:
        model = Lesson
        fields = ["title", "notes", "pasted_text"]
        labels = {
            "pasted_text": "Or paste text",
            "notes": "Notes (optional)",
        }
        widgets = {
            "title": forms.TextInput(attrs={"class": INPUT, "placeholder": "Lesson title"}),
            "notes": forms.Textarea(
                attrs={"class": TEXTAREA, "placeholder": "Internal notes", "rows": 3}
            ),
            "pasted_text": forms.Textarea(
                attrs={
                    "class": TEXTAREA,
                    "placeholder": (
                        "Blank line = new piece. Optional markup:\n\n"
                        "Hi, this is [[AJ Hoge|اِی‌جی هوگ]]. Welcome to {{amber|Power English}}.\n"
                        "@= خوش آمدید به درس‌های جدید\n"
                        "@lines 2\n\n"
                        "Psychology is [[80% of success]]. |\n"
                        "And I think he’s {{red|right}}."
                    ),
                    "rows": 8,
                }
            ),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        apply_char_limit(self.fields["title"], self.limits.lesson_title_max, model_cap=200)
        apply_char_limit(self.fields["notes"], self.limits.lesson_notes_max)
        apply_char_limit(self.fields["pasted_text"], self.limits.pasted_text_max)

    def _clean_temp_id(self, value, kind):
        value = (value or "").strip()
        if not value:
            return ""
        if not TempUpload.objects.filter(pk=value, kind=kind).exists():
            raise forms.ValidationError("Upload expired. Please choose the file again.")
        return value

    def clean_media_temp_id(self):
        return self._clean_temp_id(self.cleaned_data.get("media_temp_id"), TempUpload.Kind.MEDIA)

    def clean_document_temp_id(self):
        return self._clean_temp_id(
            self.cleaned_data.get("document_temp_id"),
            TempUpload.Kind.DOCUMENT,
        )

    def clean_title(self):
        return validate_text_length(
            self.cleaned_data.get("title") or "",
            self.limits.lesson_title_max,
            "Title",
            lang=self.lang,
        )

    def clean_notes(self):
        return validate_text_length(
            self.cleaned_data.get("notes") or "",
            self.limits.lesson_notes_max,
            "Notes",
            lang=self.lang,
        )

    def clean_pasted_text(self):
        return validate_text_length(
            self.cleaned_data.get("pasted_text") or "",
            self.limits.pasted_text_max,
            "Pasted text",
            lang=self.lang,
        )

    def clean(self):
        cleaned = super().clean()
        media_temp = cleaned.get("media_temp_id")
        document_temp = cleaned.get("document_temp_id")
        pasted = (cleaned.get("pasted_text") or "").strip()
        has_existing_doc = bool(self.instance.pk and self.instance.document_file)
        has_existing_text = bool(self.instance.pk and self.instance.extracted_text)
        has_chunks = bool(self.instance.pk and self.instance.chunks.exists())

        if self.instance.pk and has_chunks and not any(
            [media_temp, document_temp, pasted]
        ):
            return cleaned

        if not (document_temp or pasted or has_existing_doc or has_existing_text):
            raise forms.ValidationError(
                "Add a text/PDF/Word file or paste text so the lesson can be split into chunks."
            )
        return cleaned


class LessonChunkForm(forms.ModelForm):
    class Meta:
        model = LessonChunk
        fields = ["text", "sentence_meaning", "display_lines"]
        labels = {
            "text": "Sentence / piece text",
            "sentence_meaning": "Sentence meaning (optional)",
            "display_lines": "Display lines (optional)",
        }
        widgets = {
            "text": forms.Textarea(
                attrs={
                    "class": TEXTAREA,
                    "placeholder": "Lesson piece text",
                    "rows": 4,
                    "id": "id_chunk_text",
                }
            ),
            "sentence_meaning": forms.Textarea(
                attrs={
                    "class": TEXTAREA,
                    "placeholder": "Optional meaning of this whole sentence",
                    "rows": 3,
                    "id": "id_sentence_meaning",
                }
            ),
            "display_lines": forms.NumberInput(
                attrs={
                    "class": INPUT,
                    "min": 1,
                    "max": 20,
                    "placeholder": "e.g. 2",
                    "id": "id_display_lines",
                }
            ),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        apply_char_limit(self.fields["text"], self.limits.chunk_text_max)
        apply_char_limit(self.fields["sentence_meaning"], self.limits.sentence_meaning_max)

    def clean_text(self):
        return validate_text_length(
            self.cleaned_data.get("text") or "",
            self.limits.chunk_text_max,
            "Text",
            lang=self.lang,
        )

    def clean_sentence_meaning(self):
        return validate_text_length(
            self.cleaned_data.get("sentence_meaning") or "",
            self.limits.sentence_meaning_max,
            "Sentence meaning",
            lang=self.lang,
        )


class ChunkHighlightForm(forms.ModelForm):
    class Meta:
        model = ChunkHighlight
        fields = ["text", "start_char", "end_char", "meaning"]
        widgets = {
            "text": forms.HiddenInput(),
            "start_char": forms.HiddenInput(),
            "end_char": forms.HiddenInput(),
            "meaning": forms.Textarea(
                attrs={
                    "class": TEXTAREA,
                    "placeholder": "Optional — leave empty to highlight without a meaning",
                    "rows": 2,
                    "id": "id_highlight_meaning",
                }
            ),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        self.fields["meaning"].required = False
        self.fields["text"].required = False
        self.fields["start_char"].required = False
        self.fields["end_char"].required = False
        apply_char_limit(self.fields["meaning"], self.limits.highlight_meaning_max)

    def clean_meaning(self):
        return validate_text_length(
            (self.cleaned_data.get("meaning") or "").strip(),
            self.limits.highlight_meaning_max,
            "Meaning",
            lang=self.lang,
        )

    def clean(self):
        cleaned = super().clean()
        start = cleaned.get("start_char")
        end = cleaned.get("end_char")
        text = (cleaned.get("text") or "").strip()
        if start is None or end is None or end <= start or not text:
            raise forms.ValidationError("Select a word or phrase in the sentence first.")
        cleaned["meaning"] = (cleaned.get("meaning") or "").strip()
        return cleaned


class CourseReviewForm(forms.ModelForm):
    rating = forms.TypedChoiceField(
        coerce=int,
        choices=[(i, str(i)) for i in range(1, 6)],
        widget=forms.RadioSelect,
    )

    class Meta:
        model = CourseReview
        fields = ["rating", "comment"]
        widgets = {
            "comment": forms.Textarea(
                attrs={
                    "class": TEXTAREA,
                    "rows": 3,
                    "placeholder": "Share your experience (optional)",
                }
            ),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.limits = limits or get_limits_for_user(user) or defaults_snapshot()
        self.lang = lang
        apply_char_limit(self.fields["comment"], self.limits.review_comment_max)

    def clean_comment(self):
        return validate_text_length(
            (self.cleaned_data.get("comment") or "").strip(),
            self.limits.review_comment_max,
            "Comment",
            lang=self.lang,
        )
