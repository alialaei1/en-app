from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("courses", "0015_user_study_progress"),
    ]

    operations = [
        migrations.AddField(
            model_name="userchunkstudyprogress",
            name="best_speak_ms",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Best speaking completion time in milliseconds.",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="userchunkstudyprogress",
            name="best_type_ms",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Best writing (typing) completion time in milliseconds.",
                null=True,
            ),
        ),
    ]
