from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("courses", "0012_course_review"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson",
            name="source_video",
            field=models.FileField(blank=True, null=True, upload_to="lessons/video/"),
        ),
        migrations.AddField(
            model_name="lessonchunk",
            name="video",
            field=models.FileField(blank=True, null=True, upload_to="lessons/chunks/video/"),
        ),
        migrations.AlterField(
            model_name="lesson",
            name="media_file",
            field=models.FileField(
                blank=True,
                help_text="Upload an audio or video file. Video is compressed and kept as video.",
                null=True,
                upload_to="lessons/media/",
            ),
        ),
    ]
