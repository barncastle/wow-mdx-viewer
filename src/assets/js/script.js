window.addEventListener('resize', function () {
    const width = canvas?.parentElement?.offsetWidth || 0;
    const height = canvas?.parentElement?.offsetHeight || 0;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    $("#bs-canvas-right").css("bottom", $("#controls").outerHeight());
});

document.addEventListener('treeview', function (e) {
    $('#tree').treeview({
        data: e.detail,
        levels: 0,
        enableLinks: true,
        expandIcon: "icon-plus",
        collapseIcon: "icon-minus",
        onNodeSelected: function (_event, data) {
            document.dispatchEvent(new CustomEvent('selectmodel', {
                detail: data?.tags[0]
            }));
        }
    });
});

document.addEventListener('characterstyles', function (e) {
    const data = e.detail.styles;
    const reset = e.detail.reset;
    const elements = document.querySelectorAll('#charcontrols input[type="number"]');

    for (const element of elements) {
        let max = 0;
        switch (element.id) {
            case "skincolor": max = data.numSkinColor || 0; break;
            case "facetype": max = data.numFaceType || 0; break;
            case "haircolor": max = data.numHairColor || 0; break;
            case "hairtype": max = data.numHairType || 0; break;
            case "facialhairtype": max = data.numFacialHairType || 0; break;
            case "facialhaircolor": max = data.numFacialHairColor || 0; break;
        }

        element.setAttribute('max', max);

        if (reset) {
            element.value = 0;
        } else if (parseInt(element.value) < 0) {
            element.value = 0;
            element.dispatchEvent(new Event('change'));
        } else if (parseInt(element.value) > max) {
            element.value = max;
            element.dispatchEvent(new Event('change'));
        }
    }
});

// menus
$(document).ready(function ($) {
    var bsDefaults = {
        offset: false,
        overlay: true,
        width: '30%'
    };
    var bsMain = $('.bs-offset-main');
    var bsOverlay = $('.bs-canvas-overlay');
    var charControls = $('#charcontrols');

    $('[data-toggle="canvas"][aria-expanded="false"]').on('click', function () {
        var canvas = $(this).data('target'),
            opts = $.extend({}, bsDefaults, $(canvas).data()),
            prop = 'margin-left';

        if (opts.width === '100%')
            opts.offset = false;

        $(canvas).css('width', opts.width);
        if (opts.offset && bsMain.length)
            bsMain.css(prop, opts.width);

        $(canvas + ' .bs-canvas-close').attr('aria-expanded', "true");
        $('[data-toggle="canvas"][data-target="' + canvas + '"]').attr('aria-expanded', "true");
        if (opts.overlay && bsOverlay.length)
            bsOverlay.addClass('show');

        document.dispatchEvent(new CustomEvent('overlay', {
            detail: true
        }));

        return false;
    });

    $('.bs-canvas-close, .bs-canvas-overlay').on('click', function () {
        var canvas, aria;
        if ($(this).hasClass('bs-canvas-close')) {
            canvas = $(this).closest('.bs-canvas');
            aria = $(this).add($('[data-toggle="canvas"][data-target="#' + canvas.attr('id') + '"]'));
            if (bsMain.length)
                bsMain.css('margin-left', '');
        } else {
            canvas = $('.bs-canvas');
            aria = $('.bs-canvas-close, [data-toggle="canvas"]');
            if (bsMain.length)
                bsMain.css({ 'margin-left': '', 'margin-right': '' });
        }

        canvas.css('width', '');
        aria.attr('aria-expanded', "false");

        if (bsOverlay.length)
            bsOverlay.removeClass('show');

        document.dispatchEvent(new CustomEvent('overlay', {
            detail: false
        }));

        return false;
    });

    $('#charcontrols-btn').on('click', function () {
        charControls.toggleClass('open');
    });
});