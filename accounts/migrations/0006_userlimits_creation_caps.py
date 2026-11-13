# Generated manually for creation caps on UserLimits

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_profile_ui_prefs"),
    ]

    operations = [
        migrations.AddField(
            model_name="userlimits",
            name="max_courses",
            field=models.PositiveIntegerField(
                default=5,
                help_text="Max courses this user may create.",
            ),
        ),
        migrations.AddField(
            model_name="userlimits",
            name="max_sections_per_course",
            field=models.PositiveIntegerField(
                default=70,
                help_text="Max sections allowed in each of this user's courses.",
            ),
        ),
        migrations.AddField(
            model_name="userlimits",
            name="max_lessons_per_section",
            field=models.PositiveIntegerField(
                default=5,
                help_text="Max lessons allowed in each section.",
            ),
        ),
    ]
